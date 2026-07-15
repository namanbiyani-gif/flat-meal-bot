# Contributing

Contributions are welcome.

## Local development

```bash
npm ci
npm test
npm run preview -- 2026-07-20
```

Use fictional household data in tests, documentation, issues, and pull requests.

Never commit or upload:

- `.env`
- `config/household.json`
- `auth/`
- `data/`
- `logs/`
- `audio/`

Changes to meal calculations, snapshots, delivery behavior, or WhatsApp workflows should include tests.
