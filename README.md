# FixMyEPUB

Fix missing **Send to Kindle covers** and diagnose EPUB delivery failures entirely in your browser.

[Use the live tool](https://fixmyepub.com/) · [Watch the 57-second demo](https://www.youtube.com/watch?v=EW7s3TvUfUg) · [Read the troubleshooting guides](https://fixmyepub.com/guides/)

[![FixMyEPUB video demo](marketing/youtube-short/assets/youtube-thumbnail-built-tool-1280x720.jpg)](https://www.youtube.com/watch?v=EW7s3TvUfUg)

## Why this exists

An EPUB can open normally in reading apps and still arrive through Send to Kindle with a grey cover—or be rejected during conversion. FixMyEPUB inspects the package, explains the issue it can prove, applies conservative repairs, and downloads a separate repaired copy.

The entire workflow runs locally in the browser. Your ebook is not uploaded to a server.

## What it checks

- EPUB container and package-document paths
- Required package metadata
- Manifest resources and spine references
- XML readability
- Embedded cover artwork
- EPUB 2 cover metadata
- EPUB 3 `cover-image` declarations
- Referenced cover paths and image media types
- ZIP packaging details commonly rejected by stricter conversion services

## What it can repair

- Normalize EPUB 2 and EPUB 3 cover declarations
- Reconnect an existing cover image to package metadata
- Add a user-selected JPG or PNG when no usable cover exists
- Rebuild the EPUB with an uncompressed first `mimetype` entry
- Reopen the repaired output and verify it before download

FixMyEPUB does not remove DRM. It is intended for DRM-free EPUB files you are allowed to modify.

## Run locally

Requirements: Node.js 18 or newer. There are no runtime dependencies.

```bash
git clone https://github.com/tielidev/fixmyepub.git
cd fixmyepub
npm start
```

Open `http://127.0.0.1:4173`.

You can test the missing-cover flow with the included fixture:

`downloads/fixmyepub-missing-cover-reference.epub`

## How it works

The application reads the EPUB ZIP in browser memory, parses the container and OPF package, builds a diagnosis, and only offers safe repairs. Rebuilt files are generated as new downloads; the original file is never modified.

The project intentionally uses browser APIs and plain JavaScript so the privacy boundary is easy to inspect.

## Project structure

```text
app.js          EPUB parser, diagnostic and repair logic
index.html      Tool interface and product explanation
styles.css      Responsive presentation
assets/         Landing-page images
downloads/      DRM-free test EPUB
dev-server.mjs  Minimal local development server
```

## Contributing

Bug reports and focused pull requests are welcome. Please use EPUB files you own or have permission to modify, and never attach copyrighted books or personal account data to public issues.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Live product and documentation

The maintained public tool, current troubleshooting guides, and reader-facing updates live at **[fixmyepub.com](https://fixmyepub.com/)**.

## License

MIT. See [LICENSE](LICENSE).

FixMyEPUB is independent and is not affiliated with Amazon. “Kindle” and “Send to Kindle” are used only to describe compatibility.
