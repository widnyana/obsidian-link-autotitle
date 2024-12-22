# Obsidian URL Enhancer

An Obsidian plugin that automatically converts URLs into markdown links with their page titles. It works both when typing and pasting URLs.

## Features

- 🔄 Automatic URL to markdown link conversion
- 📋 Works with both typing and pasting
- 🏃‍♂️ Fast and non-blocking operation

## Installation

### Manual Installation

1. Download the latest release from this repository
2. Extract the files to your vault's `.obsidian/plugins/url-enhancer` folder
3. Reload Obsidian
4. Enable the plugin in Obsidian's Community Plugins settings

## Usage

Simply paste or type a URL, and the plugin will automatically convert it to a markdown link with the page's title.

### Examples:

```markdown
# Before:
https://example.com/some-page

# After:
[Example Page Title](https://example.com/some-page)
```

### Behaviors

- When pasting a URL, it's immediately processed
- When typing a URL, it's processed after a brief pause
- If a URL is already part of a markdown link, it's ignored
- If title fetching fails, falls back to a cleaned URL path as the title

## Development

### Prerequisites

- [Bun](https://bun.sh/)
- [Python](https://www.python.org/) (for pre-commit hooks)

### Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   bun install
   ```
3. Install pre-commit hooks:
   ```bash
   pip install pre-commit
   pre-commit install
   ```

### Building

```bash
bun run build
```

### Development Workflow

1. Create a development vault
2. Link the plugin to your vault:
   ```bash
   mkdir -p /path/to/vault/.obsidian/plugins/url-enhancer
   ln -s /path/to/repo/dist/* /path/to/vault/.obsidian/plugins/url-enhancer/
   ```
3. Enable the plugin in Obsidian

### Running Tests

who need test? YOLO!

## Configuration

Currently, the plugin works out of the box with no configuration needed. ¯\\_(ツ)_/¯

## Contributing

Pull requests are welcome! Please ensure you:

1. Follow the existing code style
2. Add tests for any new functionality
3. Update documentation as needed
4. Run pre-commit hooks before committing

## Credits

This plugin was created by [widnyana](https://github.com/widnyana) and is licensed under the WTFPL.

## License

WTFPL. See [LICENSE](LICENSE) for more information.

## Support

- 🐛 Found a bug? [Open an issue](issues/new)
- 💡 Have a suggestion? [Create a feature request](issues/new)
