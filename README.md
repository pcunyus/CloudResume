# CloudResume — Frontend

Static HTML/CSS/JS resume website for the [Azure Cloud Resume Challenge](https://cloudresumechallenge.dev/).

## Live Site

🌐 [cunyuslabs.com](https://cunyuslabs.com)

## Architecture

- **Hosting**: Azure Storage static website (`$web` container)
- **DNS**: AWS Route53 → Azure CDN (CNAME)
- **Visitor Counter**: Fetches from Azure Function API (see [backend repo](https://github.com/YOUR-USERNAME/CloudResume-backend))
- **CI/CD**: GitHub Actions auto-deploys on push to `main`

## Local Development

Simply open `index.html` in your browser. The visitor counter will show "—" until connected to a live API.

## GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `AZURE_CREDENTIALS` | Service principal JSON credentials |
| `AZURE_STORAGE_ACCOUNT_NAME` | Name of your Azure Storage account |
| `AZURE_RG` | Azure resource group name (for CDN purge) |

## Domain Setup (Route53 → Azure)

1. Enable static website hosting on your Azure Storage account
2. Set up Azure CDN with custom domain
3. In Route53, create a CNAME record pointing `cunyuslabs.com` to the Azure CDN endpoint
