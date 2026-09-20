# Contributing

Thanks for helping improve FixMyEPUB.

## Before opening an issue

- Confirm the file is a DRM-free EPUB that you are allowed to modify.
- Remove personal information from screenshots and error messages.
- Do not upload copyrighted books to a public issue.
- If possible, reproduce the problem with a minimal test EPUB containing original or public-domain content.

## Development

```bash
npm start
```

Open `http://127.0.0.1:4173`, then test both a healthy EPUB and a deliberately broken fixture.

## Pull requests

Keep changes focused. Explain the failure mode, the safety boundary of the repair, and how you verified that a rebuilt EPUB remains readable. Repairs must create a separate output file and must not add DRM-removal behavior.
