/**
 * SPDX-License-Identifier: WTFPL
 */
import { type Editor, MarkdownView, Plugin } from "obsidian";

interface ProcessingTask {
  url: string;
  lineNumber: number;
  position: number;
  timestamp: number;
}

interface RetryQueueItem {
  task: ProcessingTask;
  retries: number;
  nextRetry: number;
}

export default class URLEnhancerPlugin extends Plugin {
  private urlCache: Map<string, string> = new Map();
  private readonly MAX_CACHE_SIZE = 1000;
  private processingUrls: Set<string> = new Set();
  private processingQueue: Array<() => Promise<void>> = [];
  private isProcessing = false;
  private debounceTimeout: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_DELAY = 300; // ms
  private retryQueue: Map<string, RetryQueueItem> = new Map();

  async onload() {
    console.log("Loading Link Autotitle plugin");

    this.registerEvent(
      this.app.workspace.on("editor-change", this.handleChange.bind(this)),
    );

    this.registerEvent(
      this.app.workspace.on("editor-paste", this.handlePaste.bind(this)),
    );

    this.processRetryQueue();
  }

  onunload() {
    console.log("Unloading Link Autotitle plugin");
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    this.processingQueue = [];
    this.processingUrls.clear();
    this.urlCache.clear();
    this.retryQueue.clear();
    this.isProcessing = false;
  }

  private findURLsInText(text: string): Array<{ url: string; index: number }> {
    // First, find all markdown links to exclude them
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const excludeRanges: { start: number; end: number }[] = [];

    let markdownMatch: RegExpExecArray | null;
    while ((markdownMatch = markdownLinkRegex.exec(text)) !== null) {
      excludeRanges.push({
        start: markdownMatch.index,
        end: markdownMatch.index + markdownMatch[0].length,
      });
    }

    // Find URLs that are not in markdown links
    const urlRegex =
      /(https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*[-a-zA-Z0-9@:%_\+~#?&//=])?)/g;
    const results: Array<{ url: string; index: number }> = [];

    let match: RegExpExecArray | null;
    while (true) {
      match = urlRegex.exec(text);
      if (match === null) break;

      const urlIndex = match.index;

      // Check if the match falls within any of the exclude ranges
      const isExcluded = excludeRanges.some(
        (range) => urlIndex >= range.start && urlIndex < range.end
      );

      if (!isExcluded) {
        results.push({
          url: match[0], // The matched URL
          index: urlIndex, // The index where the URL starts
        });
      }
    }

    return results;
  }

  async handleChange(editor: Editor) {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    this.debounceTimeout = setTimeout(() => {
      const cursor = editor.getCursor();
      const currentLine = editor.getLine(cursor.line);

      const urlMatches = this.findURLsInText(currentLine);
      if (urlMatches.length === 0) return;

      const processingTasks = urlMatches.map((match) => ({
        url: match.url,
        lineNumber: cursor.line,
        position: match.index,
        timestamp: Date.now(),
      }));

      this.addToProcessingQueue(editor, processingTasks);
    }, this.DEBOUNCE_DELAY);
  }

  private async handlePaste(evt: ClipboardEvent, editor: Editor) {
    const pastedText = evt.clipboardData?.getData("text");
    if (!pastedText) return;

    const urlMatches = this.findURLsInText(pastedText);
    if (urlMatches.length > 0) {
      evt.preventDefault();
      const cursor = editor.getCursor();

      const processingTasks = urlMatches.map((match) => ({
        url: match.url,
        lineNumber: cursor.line,
        position: cursor.ch + match.index,
        timestamp: Date.now(),
      }));

      this.addToProcessingQueue(editor, processingTasks);
      editor.replaceSelection(pastedText);
    }
  }

  private addToProcessingQueue(editor: Editor, tasks: ProcessingTask[]) {
    const sortedTasks = [...tasks].sort((a, b) => a.position - b.position);

    const uniqueTasks = new Map<string, ProcessingTask>();
    for (const task of sortedTasks) {
      const key = `${task.url}-${task.lineNumber}`;
      if (!uniqueTasks.has(key)) {
        uniqueTasks.set(key, task);
      }
    }

    const processingFunctions = Array.from(uniqueTasks.values()).map(
      (task) => async () => {
        const key = `${task.url}-${task.lineNumber}-${task.position}-${task.timestamp}`;
        if (this.processingUrls.has(key)) return;

        try {
          await this.processURL(editor, task, key);
        } catch (error) {
          console.error(`Failed to process URL ${task.url}:`, error);
          if (error instanceof Error && error.message.includes("fetch")) {
            this.addToRetryQueue(editor, task);
          }
        }
      },
    );

    this.processingQueue.push(...processingFunctions);

    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  private async processQueue() {
    if (this.isProcessing || this.processingQueue.length === 0) return;

    this.isProcessing = true;

    try {
      while (this.processingQueue.length > 0) {
        const task = this.processingQueue.shift();
        if (task) {
          await task();
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async processRetryQueue() {
    const now = Date.now();
    const retries = Array.from(this.retryQueue.entries()).filter(
      ([_, item]) => item.nextRetry <= now,
    );

    for (const [key, item] of retries) {
      try {
        const editor = this.getActiveEditor();
        if (editor) {
          await this.processURL(editor, item.task, key);
          this.retryQueue.delete(key);
        }
      } catch (error) {
        if (item.retries >= 3) {
          this.retryQueue.delete(key);
        }
      }
    }

    setTimeout(() => this.processRetryQueue(), 5000);
  }

  private getActiveEditor(): Editor | null {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    return activeView?.editor ?? null;
  }

  private async processURL(
    editor: Editor,
    task: ProcessingTask,
    key: string,
  ): Promise<void> {
    this.processingUrls.add(key);

    try {
      const currentLine = editor.getLine(task.lineNumber);
      if (
        !currentLine ||
        currentLine.indexOf(task.url, task.position) !== task.position
      ) {
        return;
      }

      let title: string;
      if (this.urlCache.has(task.url)) {
        const cachedTitle = this.urlCache.get(task.url);
        if (typeof cachedTitle !== "string") {
          throw new Error("Invalid cache entry");
        }
        title = cachedTitle;
      } else {
        title = await this.fetchPageTitleWithRetry(task.url);
        this.updateCache(task.url, title);
      }

      const markdownLink = `[${title}](${task.url})`;
      this.replaceURLWithMarkdown(editor, task, markdownLink);
    } finally {
      this.processingUrls.delete(key);
    }
  }

  private async fetchPageTitleWithRetry(
    url: string,
    retries = 3,
    delay = 1000,
  ): Promise<string> {

    try {
      // Try oEmbed first for any website that supports it
      const oEmbedResponse = await fetch(`https://noembed.com/embed?url=${url}`);
      if (oEmbedResponse.ok) {
        const data = await oEmbedResponse.json();
        if (data.title && data.provider_name) return `${data.provider_name} - ${data.title}`;
      }
    } catch (e) {
      console.warn("oEmbed fetch failed", e);
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        try {
          const response = await fetch(url, {
            headers: { "User-Agent": "Obsidian-URLEnhancer" },
          });

          if (response.ok) {
            const html = await response.text();
            const titleMatch = html.match(/<title>(.*?)<\/title>/i);
            if (titleMatch) return titleMatch[1].trim();
          }
        } catch (e) {
          console.warn("Direct fetch failed, trying no-cors mode");
        }

        try {
          const response = await fetch(url, {
            mode: "no-cors",
            headers: { "User-Agent": "Obsidian-URLEnhancer" },
          });

          if (response.type === "opaque") {
            return this.getTitleFromURL(url);
          }
        } catch (e) {
          console.warn("No-cors fetch failed");
        }

        return this.getTitleFromURL(url);
      } catch (error) {
        if (attempt === retries) throw error;
        console.warn(
          `Retrying fetch for ${url}... (${retries - attempt} retries left)`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, delay * Math.pow(2, attempt)),
        );
      }
    }
    return url;
  }

  private getTitleFromURL(url: string): string {
    try {
      const urlObj = new URL(url);

      let pathTitle = urlObj.pathname.split("/").pop() || "";
      pathTitle = decodeURIComponent(pathTitle).replace(/[-_]/g, " ");

      if (!pathTitle || pathTitle === "/") {
        pathTitle = urlObj.hostname.replace(/^www\./, "");
      }

      pathTitle = pathTitle
        .replace(/\.(html|php|aspx?)$/i, "")
        .replace(/[_-]/g, " ")
        .split(" ")
        .map(
          (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join(" ")
        .trim();

      return pathTitle || urlObj.hostname;
    } catch (e) {
      return url;
    }
  }

  private addToRetryQueue(editor: Editor, task: ProcessingTask) {
    const key = `${task.url}-${task.lineNumber}-${task.position}`;
    const existing = this.retryQueue.get(key);

    if (!existing || existing.retries < 3) {
      this.retryQueue.set(key, {
        task,
        retries: (existing?.retries ?? 0) + 1,
        nextRetry: Date.now() + Math.pow(2, existing?.retries ?? 0) * 1000,
      });
    }
  }

  private updateCache(url: string, title: string): void {
    if (this.urlCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.urlCache.keys().next().value;
      this.urlCache.delete(firstKey);
    }
    this.urlCache.set(url, title);
  }

  private replaceURLWithMarkdown(
    editor: Editor,
    task: ProcessingTask,
    markdownLink: string,
  ): void {
    const line = editor.getLine(task.lineNumber);
    if (!line) return;

    const before = line.substring(0, task.position);
    const after = line.substring(task.position + task.url.length);
    const newLine = before + markdownLink + after;
    editor.setLine(task.lineNumber, newLine);
  }
}
