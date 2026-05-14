# Cloud Resume Challenge — Architecture & Implementation Guide

**Author:** Patrick Cunyus  
**Live Site:** [cunyuslabs.com](https://cunyuslabs.com)  
**Stack:** Azure (Functions · Cosmos DB · Blob Storage · CDN) · AWS Route 53 · GitHub Actions  
**Purpose:** Portfolio documentation for potential employers — reasoning, trade-offs, and lessons learned behind every decision.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [High-Level Architecture Diagram](#2-high-level-architecture-diagram)
3. [Services Inventory — What We Used & Why](#3-services-inventory--what-we-used--why)
4. [Frontend — Azure Blob Storage Static Website](#4-frontend--azure-blob-storage-static-website)
5. [DNS & Domain Management — AWS Route 53](#5-dns--domain-management--aws-route-53)
6. [SSL/TLS & CDN — Azure CDN](#6-ssltls--cdn--azure-cdn)
7. [Backend API — Azure Functions](#7-backend-api--azure-functions)
8. [Database — Azure Cosmos DB](#8-database--azure-cosmos-db)
9. [Visitor Counter — End-to-End Flow](#9-visitor-counter--end-to-end-flow)
10. [CI/CD Pipeline — GitHub Actions](#10-cicd-pipeline--github-actions)
11. [Security Architecture](#11-security-architecture)
12. [Cost Management & Budget Monitoring](#12-cost-management--budget-monitoring)
13. [High Availability Design](#13-high-availability-design)
14. [Architectural Weaknesses & Mitigations](#14-architectural-weaknesses--mitigations)
15. [Infrastructure Diagrams](#15-infrastructure-diagrams)
16. [Issues Encountered & Changes Made](#16-issues-encountered--changes-made)
17. [Lessons Learned & What I Would Do Differently](#17-lessons-learned--what-i-would-do-differently)

---

## 1. Executive Summary

The Cloud Resume Challenge is a hands-on project designed by Forrest Brazeal to bridge the gap between studying for cloud certifications and doing real cloud engineering. The challenge requires building a resume website using cloud-native services, including serverless compute, a NoSQL database, a CI/CD pipeline, infrastructure as code, and custom DNS with HTTPS — all wired together so that every piece integrates with the next.

### What Was Built

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | HTML / CSS / JavaScript | Resume content + visitor counter UI |
| Hosting | Azure Blob Storage (static website) | Serves static files globally |
| CDN / HTTPS | Azure CDN | HTTPS termination, caching, custom domain |
| DNS | AWS Route 53 | Domain registration and name resolution |
| API | Azure Functions (HTTP trigger, Python) | Serverless backend for visitor counter |
| Database | Azure Cosmos DB (NoSQL) | Persistent, scalable visitor count storage |
| CI/CD | GitHub Actions | Automated deploy on every git push |
| Secrets Management | GitHub Secrets | Credentials never in source code |

### What This Demonstrates

- Ability to architect a multi-cloud solution using Azure as the primary cloud and AWS Route 53 for DNS
- Understanding of serverless patterns, NoSQL databases, and CDN caching
- Security-first thinking: no credentials in code, least-privilege service principals, HTTPS everywhere
- DevOps practices: automated deployment pipeline, infrastructure managed through code
- Cost consciousness: every service chosen is either free-tier eligible or low-cost for a personal project

---

## 2. High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          VISITOR'S BROWSER                          │
│                                                                     │
│   Types: cunyuslabs.com  ───►  DNS Lookup  ───►  AWS Route 53      │
└─────────────────────────┬───────────────────────────────────────────┘
                          │  CNAME → Azure CDN Endpoint
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         AWS ROUTE 53                                │
│                                                                     │
│  A/CNAME Record: cunyuslabs.com → <endpoint>.azureedge.net         │
│  ACM Validation CNAME: for SSL cert DNS verification               │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         AZURE CDN                                   │
│                                                                     │
│  • HTTPS termination (TLS 1.2+)                                    │
│  • Custom domain: cunyuslabs.com                                   │
│  • Caches static assets at edge PoPs globally                      │
│  • Origin: Azure Blob Storage static website endpoint               │
└──────────────┬──────────────────────────────────────────────────────┘
               │  Cache MISS → fetch from origin
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  AZURE BLOB STORAGE ($web container)                │
│                                                                     │
│   index.html  │  css/styles.css  │  js/main.js                     │
│                                                                     │
│   Static website endpoint (HTTP, no custom domain)                 │
│   CDN is the only entry point for end users (HTTPS)                │
└─────────────────────────────────────────────────────────────────────┘

                    BROWSER — Visitor Counter Flow
┌─────────────────────────────────────────────────────────────────────┐
│  js/main.js  POST /api/counter                                      │
│      │                                                              │
│      └──────────────────────────────────────────────────────────►  │
│                                                                     │
│                    AZURE FUNCTIONS (Consumption Plan)               │
│                                                                     │
│   Endpoint: cunyuslabs-api.azurewebsites.net/api/counter           │
│   Runtime:  Python 3.x  │  HTTP Trigger (POST)                     │
│   CORS:     cunyuslabs.com only                                     │
│                                                                     │
│   Logic:                                                            │
│     1. Read current count from Cosmos DB                           │
│     2. Increment count                                             │
│     3. Write new count back                                        │
│     4. Return { "count": N }                                       │
│                                                                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │  Cosmos DB SDK connection
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  AZURE COSMOS DB (NoSQL / Core API)                 │
│                                                                     │
│   Database:    VisitorDB                                           │
│   Container:   Counters                                            │
│   Document:    { "id": "visitors", "count": N }                    │
│   Consistency: Session (default)                                   │
└─────────────────────────────────────────────────────────────────────┘

                    DEVELOPER — CI/CD Flow
┌─────────────────────────────────────────────────────────────────────┐
│  Developer pushes to master branch                                  │
│      │                                                              │
│      ▼                                                              │
│  GitHub Actions Workflow (.github/workflows/frontend-ci-cd.yml)    │
│      │                                                              │
│      ├── 1. Checkout code (actions/checkout@v4)                    │
│      ├── 2. Azure Login (service principal via AZURE_CREDENTIALS)  │
│      └── 3. Upload to $web container (az storage blob upload-batch)│
│                                                                     │
│  Secrets (never in code):                                          │
│    AZURE_CREDENTIALS          → service principal JSON              │
│    AZURE_STORAGE_ACCOUNT_NAME → storage account name               │
│    AZURE_RG                   → resource group name                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Services Inventory — What We Used & Why

### 3.1 Comparison Table

| Service | Category | Provider | Chosen Over | Reason for Choice |
|---|---|---|---|---|
| Azure Blob Storage | Static hosting | Azure | GitHub Pages, Netlify, AWS S3 | Native Azure integration; free egress from Azure CDN origin; part of the Challenge |
| Azure CDN | CDN / HTTPS | Azure | CloudFront, Cloudflare | Same Azure resource group as storage; free custom domain HTTPS |
| Azure Functions | Serverless compute | Azure | AWS Lambda, Google Cloud Functions | Challenge requirement; Azure ecosystem cohesion |
| Azure Cosmos DB | NoSQL database | Azure | DynamoDB, Firebase, Table Storage | Challenge requirement; global replication capability; free tier available |
| AWS Route 53 | DNS | AWS | Azure DNS, Cloudflare DNS, Namecheap | Domain was registered here; best-in-class reliability (100% SLA) |
| GitHub Actions | CI/CD | GitHub | Azure Pipelines, Jenkins, CircleCI | Free for public repos; native GitHub integration; widely recognized by employers |
| GitHub Secrets | Secrets management | GitHub | Azure Key Vault, HashiCorp Vault | Zero-cost for this scale; integrated with Actions; no additional service to maintain |

### 3.2 Detailed Reasoning

#### Azure Blob Storage — Static Website Hosting

Azure Blob Storage's static website feature turns a storage container into an HTTP file server at no additional compute cost. The `$web` container designation is special — Azure treats it as the origin for the static website endpoint.

**Why not GitHub Pages?**
- GitHub Pages doesn't demonstrate cloud infrastructure skills
- No control over CDN, headers, or caching behavior
- Doesn't integrate with a CI/CD pipeline to an actual cloud provider

**Why not Netlify or Vercel?**
- Platform-as-a-service providers abstract away the infrastructure — they handle CDN, HTTPS, and deployments automatically, which removes the learning opportunity
- A potential employer wants to see that you can wire together raw cloud primitives, not that you can click "deploy" on a hosting platform

**Why not AWS S3?**
- We're building on Azure for this challenge; using S3 would split the architecture across two clouds unnecessarily
- Azure CDN + Azure Blob Storage have zero egress fees between each other (same provider), saving money

#### Azure CDN

Azure CDN sits in front of Blob Storage and provides:
- HTTPS termination with a free managed certificate for custom domains
- Global edge caching (Points of Presence / PoPs) that serve cached content from locations physically close to the visitor
- Custom domain support (`cunyuslabs.com`)

**Why not CloudFront?**
- CloudFront requires an ACM certificate, which only works with AWS services — mixing CloudFront in front of Azure Blob Storage creates unnecessary complexity and latency
- If the origin is Azure, the CDN should be Azure to minimize cross-cloud data transfer costs

**Why not Cloudflare?**
- Cloudflare Free tier is a legitimate option and would provide comparable caching and HTTPS
- Azure CDN keeps everything within one billing account and one Azure resource group, simplifying management
- Cloudflare Free doesn't support some advanced origin header controls

#### Azure Functions — Serverless API

Azure Functions with the Consumption plan means we pay only for the number of function executions, not for idle server time. For a personal resume site receiving a few hundred visits per month, the cost is effectively $0 (the free grant is 1 million executions/month).

**Why not a dedicated server or App Service?**
- A VM or dedicated App Service running 24/7 costs ~$15–50+/month with zero traffic benefit
- This project receives sporadic traffic — serverless is the correct pattern for bursty, low-volume workloads

**Why not AWS Lambda?**
- Lambda would require an API Gateway in front of it (additional cost and complexity)
- Lambda + API Gateway cannot natively connect to Cosmos DB without a VPC or network peering configuration
- Azure Functions + Cosmos DB are designed to work together via native SDK bindings

**Why not a simple serverless function on Vercel or Netlify?**
- Same reason as before: we want to demonstrate direct cloud service wiring, not abstractions

#### Azure Cosmos DB

Cosmos DB is a globally distributed, multi-model NoSQL database. For this project, we used the Core (SQL) API, which stores JSON documents and queries them with a SQL-like syntax.

**Why NoSQL instead of a relational database (SQL)?**
- A visitor counter has a dead-simple data model: one document with an `id` and a `count` field
- A relational database (Azure SQL, MySQL, PostgreSQL) introduces schemas, migrations, and connection pooling — all unnecessary complexity for a single document
- NoSQL document storage is elastic and requires zero schema maintenance

**Why Cosmos DB instead of Azure Table Storage?**
- Azure Table Storage is older, has weaker consistency guarantees, and lacks the global distribution capabilities of Cosmos DB
- Cosmos DB has a generous free tier (1,000 RU/s + 25 GB)
- Cosmos DB is the "flagship" Azure NoSQL product — more relevant for a portfolio demonstration

**Why Cosmos DB instead of AWS DynamoDB?**
- DynamoDB is an AWS service; mixing it with Azure Functions would require public internet connectivity and IAM credentials stored as secrets in the Function — an unnecessary security surface
- Cosmos DB and Azure Functions can communicate over Azure's internal network backbone

#### AWS Route 53 — DNS

Route 53 was used because the domain `cunyuslabs.com` was registered directly through AWS Route 53. Rather than transferring the domain to another registrar, we kept it where it was registered and created the necessary DNS records to point to Azure infrastructure.

**Multi-cloud DNS → Azure origin: how it works**
1. Visitor's browser queries Route 53 for `cunyuslabs.com`
2. Route 53 returns a CNAME record pointing to the Azure CDN endpoint (`<name>.azureedge.net`)
3. The browser connects to the Azure CDN edge node
4. The CDN serves content — the visitor never sees Azure CDN's domain name

**Why not transfer the domain to Azure DNS or Cloudflare?**
- Domain transfers take 5–7 days and can disrupt DNS resolution
- Route 53 charges $0.50/hosted zone/month — negligible
- Route 53 has a 100% uptime SLA, which is best-in-class

#### GitHub Actions — CI/CD

GitHub Actions is the de facto standard for CI/CD in open-source and small-team environments. Every push to the `master` branch triggers an automated workflow that:
1. Checks out the latest code
2. Authenticates to Azure
3. Uploads all files to the Blob Storage `$web` container

**Why not Azure DevOps Pipelines?**
- The code already lives in GitHub — GitHub Actions requires zero additional tooling or account setup
- Azure DevOps is powerful for enterprise teams but adds friction for solo projects
- GitHub Actions YAML syntax is widely understood and a recognized skill in job listings

**Why not manual FTP or Azure Portal uploads?**
- Manual deployments are error-prone and not repeatable
- CI/CD is a core competency for any cloud role — demonstrating it here signals engineering maturity

---

## 4. Frontend — Azure Blob Storage Static Website

### 4.1 What Was Built

The frontend is a single-page HTML/CSS/JavaScript resume with:
- A responsive layout using CSS custom properties and Grid/Flexbox
- Scroll-reveal animations using the IntersectionObserver API
- A visitor counter in the footer that calls the Azure Function API on every page load
- An animated number counter that counts up from zero using requestAnimationFrame
- Mobile-responsive navigation with a hamburger toggle
- JSON-LD structured data for SEO

### 4.2 How to Set Up via Azure Management Console

1. Navigate to the **Azure Portal** → **Storage accounts** → **+ Create**
2. Fill in:
   - **Resource Group**: Create or select (e.g., `rg-cloudresume`)
   - **Storage account name**: Must be globally unique (e.g., `cunyuslabsresume`)
   - **Region**: East US 2 (or your nearest region)
   - **Redundancy**: LRS (Locally Redundant Storage) — cheapest, sufficient for a CDN-fronted site
3. Click **Review + Create** → **Create**
4. Once deployed, navigate to the storage account → **Data management** → **Static website**
5. Toggle **Static website** to **Enabled**
6. Set **Index document name**: `index.html`
7. Set **Error document path**: `index.html` (SPA — send 404s back to index)
8. Click **Save** — Azure generates a primary endpoint URL like `https://<account>.z13.web.core.windows.net`
9. Navigate to **Containers** → you will see a `$web` container was auto-created
10. Upload your `index.html`, `css/`, and `js/` files to the `$web` container

### 4.3 How to Set Up via Azure CLI

```bash
# Create a resource group
az group create --name rg-cloudresume --location eastus2

# Create the storage account
az storage account create \
  --name cunyuslabsresume \
  --resource-group rg-cloudresume \
  --location eastus2 \
  --sku Standard_LRS \
  --kind StorageV2

# Enable static website hosting
az storage blob service-properties update \
  --account-name cunyuslabsresume \
  --static-website \
  --index-document index.html \
  --404-document index.html

# Upload site files
az storage blob upload-batch \
  --account-name cunyuslabsresume \
  --source . \
  --destination '$web' \
  --overwrite true
```

### 4.4 Outcome

- Site is now reachable at `https://cunyuslabsresume.z13.web.core.windows.net`
- HTTP (port 80) and HTTPS (port 443) are both available at the blob endpoint
- The `$web` container is configured with public blob access (blobs are publicly readable by design for a website)
- Files are replicated across 3 copies within the selected Azure datacenter (LRS)

---

## 5. DNS & Domain Management — AWS Route 53

### 5.1 Overview

The domain `cunyuslabs.com` was registered through AWS Route 53. Route 53 acts as both the domain registrar and the authoritative DNS nameserver. The nameservers assigned to the domain are:

| Nameserver |
|---|
| ns-423.awsdns-52.com |
| ns-1392.awsdns-46.org |
| ns-1873.awsdns-42.co.uk |
| ns-611.awsdns-12.net |

These are the authoritative nameservers that the global DNS system queries when anyone looks up `cunyuslabs.com`.

### 5.2 DNS Records Created

| Record Name | Type | Value | TTL | Purpose |
|---|---|---|---|---|
| `cunyuslabs.com` | CNAME | `<endpoint>.azureedge.net` | 300s | Point apex domain to Azure CDN |
| `www.cunyuslabs.com` | CNAME | `<endpoint>.azureedge.net` | 300s | www redirect to CDN |
| `_5bb4182ba...cunyuslabs.com` | CNAME | `_a31d042c...jkddzztszm.acm-validations.aws.` | 300s | ACM certificate DNS validation |
| `_650624a53...www.cunyuslabs.com` | CNAME | `_d6d4039e1...jkddzztszm.acm-validations.aws.` | 300s | ACM certificate DNS validation (www) |

### 5.3 SSL Certificate Validation

During setup, AWS Certificate Manager (ACM) was used to issue an SSL certificate for `cunyuslabs.com` and `www.cunyuslabs.com`. ACM uses DNS validation — it asks you to add a CNAME record to prove you own the domain. The CNAME records in the table above (the `_5bb...` and `_650...` records) were added to Route 53 to complete this validation.

> **Note on ACM + Azure CDN**: ACM certificates are scoped to AWS services (CloudFront, ALB, etc.) and cannot be directly imported into Azure CDN. The ACM certificate was provisioned during an exploratory phase where AWS CloudFront was evaluated as the CDN. The project ultimately used Azure CDN instead, which provisions its own managed certificate automatically when you add a custom domain. The ACM validation CNAME records remain in Route 53 but the ACM cert is not actively used.

### 5.4 How to Set Up DNS via AWS Console

1. Log in to **AWS Console** → **Route 53** → **Hosted zones**
2. Click your hosted zone for `cunyuslabs.com`
3. Click **Create record**
4. Select **CNAME** record type
5. Enter the Azure CDN endpoint as the value (e.g., `cunyuslabs-cdn.azureedge.net`)
6. Set TTL to `300` seconds (5 minutes — allows DNS changes to propagate quickly)
7. Click **Create records**

---

## 6. SSL/TLS & CDN — Azure CDN

### 6.1 What Azure CDN Does

Azure CDN (Content Delivery Network) is a globally distributed network of edge servers that cache content close to end users. When a visitor requests `cunyuslabs.com`:

1. Route 53 returns the Azure CDN endpoint address
2. The browser connects to the nearest Azure CDN **Point of Presence (PoP)** — a datacenter in the visitor's geographic region
3. If the CDN has the page cached, it returns the cached copy immediately (sub-10ms response time)
4. If not (a "cache miss"), the CDN fetches the content from Azure Blob Storage (the origin) and caches it for future requests

### 6.2 Why This Matters for Performance

Without a CDN:
- Every visitor hits the Azure Blob Storage origin in East US 2
- A visitor in Australia or Europe experiences 150–300ms of round-trip latency just to get a response header

With Azure CDN:
- A visitor in Sydney hits an Australian CDN PoP
- Cached files are served in <15ms
- Origin load is dramatically reduced

### 6.3 How to Set Up Azure CDN via Management Console

1. In **Azure Portal**, navigate to your storage account → **Security + networking** → **Azure CDN**
2. Click **+ New endpoint**
3. Fill in:
   - **CDN profile**: Create new (e.g., `cunyuslabs-cdn-profile`)
   - **Pricing tier**: Standard Microsoft (cheapest, sufficient for this use case)
   - **CDN endpoint name**: `cunyuslabs` (becomes `cunyuslabs.azureedge.net`)
   - **Origin type**: Storage static website
   - **Origin hostname**: Your static website endpoint
4. Click **Create**
5. After the endpoint is created, navigate to it → **Custom domains** → **+ Custom domain**
6. Enter `cunyuslabs.com`
7. Enable **Custom domain HTTPS** — Azure provisions a free DigiCert certificate and automatically renews it
8. Set **HTTPS** protocol in the CDN rules to redirect all HTTP traffic to HTTPS

### 6.4 CDN Caching Rules

| Asset Type | Cache Duration | Reasoning |
|---|---|---|
| `index.html` | Short (1–5 minutes) | Content changes on every deploy; must refresh quickly |
| `css/styles.css` | Long (7–30 days) | Filename is static; changes deploy new content but old file can be cached |
| `js/main.js` | Long (7–30 days) | Same as CSS — rarely changes |
| Fonts (Google Fonts CDN) | Browser-controlled | Google handles their own CDN headers |

> **Best practice**: Add content hashes to filenames (e.g., `styles.a3f2c1.css`) so the CDN can cache indefinitely and a new hash forces a cache miss. This is the next improvement planned for this project.

### 6.5 CDN Cache Purge via CI/CD

The GitHub Actions workflow has a commented-out CDN purge step:

```yaml
# - name: Purge Azure CDN endpoint
#   uses: azure/CLI@v2
#   with:
#     inlineScript: |
#       az cdn endpoint purge \
#         --resource-group ${{ secrets.AZURE_RG }} \
#         --profile-name ${{ secrets.AZURE_CDN_PROFILE }} \
#         --name ${{ secrets.AZURE_CDN_ENDPOINT }} \
#         --content-paths '/*'
```

This step will be activated once the CDN profile and endpoint names are added as GitHub Secrets. Without it, users may see cached (stale) content for up to the cache TTL after a deployment.

---

## 7. Backend API — Azure Functions

### 7.1 Architecture Decision

The visitor counter requires server-side logic because:
- **The counter must be stored in a persistent database** — JavaScript running in the browser cannot safely write to a database (anyone could forge requests and set the count to any value)
- **The database connection string must be kept secret** — it cannot live in client-side JavaScript
- A serverless function solves both: it runs server-side (secret credentials are safe), and it scales to zero when idle (no cost)

### 7.2 Function Design

The Azure Function is an HTTP-triggered Python function deployed at:
```
https://cunyuslabs-api.azurewebsites.net/api/counter
```

**Request**: `POST /api/counter` (no body required)  
**Response**:
```json
{
  "count": 42
}
```

**Logic flow**:
1. Function receives HTTP POST request
2. Opens connection to Cosmos DB using the connection string stored in Azure Application Settings (environment variable — never in code)
3. Reads the document with `id = "visitors"` from the `Counters` container
4. Increments the `count` field by 1
5. Writes the updated document back to Cosmos DB
6. Returns the new count as JSON

### 7.3 How to Set Up via Azure Console

1. Navigate to **Azure Portal** → **Function App** → **+ Create**
2. Configure:
   - **Resource Group**: `rg-cloudresume` (same as storage)
   - **Function App name**: `cunyuslabs-api`
   - **Runtime**: Python 3.11
   - **Plan**: Consumption (Serverless) — pay per execution
   - **Region**: Same as Cosmos DB (East US 2) to minimize latency
3. After deployment, navigate to the Function App → **Functions** → **+ Create**
4. Select **HTTP trigger** template
5. Set **Authorization level**: Function (requires a function key in the request URL — one layer of protection)
6. Write the Cosmos DB logic in the function code

### 7.4 Application Settings (Environment Variables)

The Cosmos DB connection string is stored as an **Application Setting** in the Function App — not hardcoded in source code:

| Setting Name | Value | Purpose |
|---|---|---|
| `COSMOS_DB_CONNECTION_STRING` | `AccountEndpoint=https://...` | Full Cosmos DB connection string |
| `COSMOS_DB_DATABASE_NAME` | `VisitorDB` | Database name |
| `COSMOS_DB_CONTAINER_NAME` | `Counters` | Container name |

Application Settings are encrypted at rest by Azure and injected as environment variables at runtime. This means:
- The code reads `os.environ["COSMOS_DB_CONNECTION_STRING"]`
- The actual value is never committed to git
- Azure encrypts these values in its configuration store

### 7.5 CORS Configuration

Cross-Origin Resource Sharing (CORS) was configured on the Function App to only accept requests from the website's domain:

```
Allowed origins: https://cunyuslabs.com
```

Without CORS restrictions, any website on the internet could call the visitor counter API and inflate the count. With CORS set to `cunyuslabs.com` only, browsers will block requests from any other origin.

> **Note**: CORS is a browser-enforced security feature. A developer using `curl` or Postman can still call the API directly. For stronger protection, add a secret API key header or use Azure API Management.

---

## 8. Database — Azure Cosmos DB

### 8.1 Data Model

Cosmos DB (Core SQL API) stores JSON documents. The visitor counter uses the simplest possible schema:

```json
{
  "id": "visitors",
  "count": 142,
  "_rid": "...",
  "_self": "...",
  "_etag": "\"...\"",
  "_attachments": "attachments/",
  "_ts": 1715000000
}
```

- `id`: The document primary key — there is only ever one document for the counter
- `count`: The current visitor count, incremented on every API call
- `_rid`, `_self`, `_etag`, `_ts`: Cosmos DB system fields (read-only metadata)

### 8.2 Hierarchy

```
Cosmos DB Account: cunyuslabs-cosmos
  └── Database: VisitorDB
        └── Container: Counters
              └── Document: { "id": "visitors", "count": N }
```

### 8.3 How to Set Up via Azure Console

1. Navigate to **Azure Portal** → **Azure Cosmos DB** → **+ Create**
2. Select **Azure Cosmos DB for NoSQL** (Core API)
3. Configure:
   - **Account name**: `cunyuslabs-cosmos` (globally unique)
   - **Location**: East US 2
   - **Capacity mode**: Serverless (pay per request — best for low-traffic sites)
   - **Free tier**: Apply (first account gets 1,000 RU/s + 25 GB free)
4. After deployment, navigate to the account → **Data Explorer** → **New Database**
5. Database ID: `VisitorDB`
6. Navigate to the database → **New Container**
7. Container ID: `Counters`; Partition key: `/id`
8. In Data Explorer, click **Items** → **New Item** → paste the initial document:
   ```json
   { "id": "visitors", "count": 0 }
   ```
9. Click **Save**

### 8.4 Consistency Level

Cosmos DB offers five consistency levels:

| Level | Behavior | Best For |
|---|---|---|
| Strong | Always reads latest write | Financial transactions |
| Bounded Staleness | Reads lag behind by N updates or T time | Global leaderboards |
| **Session** | Consistent within a session | **Our use case (default)** |
| Consistent Prefix | Reads never see out-of-order writes | Social media feeds |
| Eventual | Fastest, but reads may be stale | Cache invalidation |

We used **Session** consistency (the default). This means:
- Within a single function invocation, reads always see our own writes
- Across different concurrent visitors, there's a tiny window where the count could be off by 1-2
- For a visitor counter, this is perfectly acceptable

### 8.5 Connection String Security

The Cosmos DB account has two read-write keys and two read-only keys. We use the **primary read-write connection string** for the function (since it needs to increment the count). This string is stored only in Azure Application Settings — never in code or GitHub.

**Best practice improvement**: For a production system, use a **read-only key** for any operation that only needs to read, and a write key only where writes are needed. Even better: use Azure Managed Identity so no connection string is needed at all (the Function authenticates to Cosmos DB via its Azure AD identity).

---

## 9. Visitor Counter — End-to-End Flow

### 9.1 Sequence Diagram

```
Browser          Azure CDN         Blob Storage      Azure Function    Cosmos DB
   │                │                   │                 │               │
   │─── GET / ─────►│                   │                 │               │
   │                │── (cache miss) ───►│                 │               │
   │                │◄── index.html ────│                 │               │
   │◄── index.html ─│                   │                 │               │
   │                │                   │                 │               │
   │  (page loads, JS runs)             │                 │               │
   │                                    │                 │               │
   │─── POST /api/counter ──────────────┼────────────────►│               │
   │                                    │                 │── Read doc ──►│
   │                                    │                 │◄─ { count:N } ─│
   │                                    │                 │── Write N+1 ──►│
   │                                    │                 │◄─ Confirmed ───│
   │◄─── { "count": N+1 } ─────────────┼─────────────────│               │
   │                                    │                 │               │
   │  (animateCounter runs,             │                 │               │
   │   counts up from 0 to N+1)         │                 │               │
```

### 9.2 Frontend Counter Code

The counter in `js/main.js` (line 11–29) POSTs to the API on every page load:

```javascript
const API_BASE_URL = 'https://cunyuslabs-api.azurewebsites.net/api';

async function updateVisitorCount() {
    const counterEl = document.getElementById('visitor-count');
    try {
        const response = await fetch(`${API_BASE_URL}/counter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        animateCounter(counterEl, data.count);  // animated count-up
    } catch (err) {
        counterEl.textContent = '—';  // graceful fallback if API is down
    }
}
```

**Design decisions**:
- `POST` is used instead of `GET` because the request has a side effect (incrementing the database) — REST semantics say GET requests should be idempotent (no side effects)
- The counter falls back to `—` if the API is unavailable, so a Cosmos DB outage doesn't break the resume page
- The `animateCounter` function uses `requestAnimationFrame` for a smooth easing animation — counts up from 0 to the actual number over 1.5 seconds

---

## 10. CI/CD Pipeline — GitHub Actions

### 10.1 Workflow File

Location: [.github/workflows/frontend-ci-cd.yml](.github/workflows/frontend-ci-cd.yml)

```yaml
name: Deploy Frontend to Azure Storage

on:
  push:
    branches: [master]       # Auto-deploy on every push to master
  workflow_dispatch:          # Also allow manual trigger from GitHub UI

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Azure Login
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Upload to Azure Storage $web container
        uses: azure/CLI@v2
        with:
          inlineScript: |
            az storage blob upload-batch \
              --account-name ${{ secrets.AZURE_STORAGE_ACCOUNT_NAME }} \
              --auth-mode key \
              -s . \
              -d '$web' \
              --overwrite true \
              --pattern '*'
```

### 10.2 Step-by-Step Explanation

| Step | What It Does | Why It's Needed |
|---|---|---|
| `actions/checkout@v4` | Clones the repository into the runner VM | The runner starts with no code — this fetches it |
| `azure/login@v2` | Authenticates to Azure using the service principal JSON in `AZURE_CREDENTIALS` | All subsequent `az` commands need an authenticated session |
| `az storage blob upload-batch` | Uploads all files from the repo root to the `$web` container | Deploys the site; `--overwrite true` replaces changed files |

### 10.3 Secrets Setup

Secrets are configured in **GitHub Repository → Settings → Secrets and variables → Actions**:

| Secret | How to Get It | Description |
|---|---|---|
| `AZURE_CREDENTIALS` | `az ad sp create-for-rbac --sdk-auth` | Service principal JSON with tenant/client/secret |
| `AZURE_STORAGE_ACCOUNT_NAME` | Azure Portal → Storage account → Overview | The storage account name (not the full URL) |
| `AZURE_RG` | Azure Portal → Resource groups | Resource group containing CDN (for future purge step) |

### 10.4 Service Principal Creation

```bash
# Create a service principal with Contributor access scoped to the storage account only
az ad sp create-for-rbac \
  --name "sp-cloudresume-github" \
  --role contributor \
  --scopes /subscriptions/<sub-id>/resourceGroups/rg-cloudresume/providers/Microsoft.Storage/storageAccounts/cunyuslabsresume \
  --sdk-auth
```

This outputs a JSON blob. Copy the entire JSON and paste it as the value for the `AZURE_CREDENTIALS` GitHub Secret. The service principal only has access to that one storage account — not to the entire subscription.

### 10.5 Why `workflow_dispatch` Was Added

The `workflow_dispatch` trigger allows manually running the workflow from the GitHub Actions UI without making a code change. This is useful for:
- Redeploying after a manual fix was made in the Azure Portal
- Testing the workflow itself
- Recovering from a failed deploy without making an empty commit

### 10.6 Pipeline Diagram

```
Developer's Machine
        │
        │  git push origin master
        ▼
┌─────────────────────────────────────────────┐
│              GitHub Repository              │
│                                             │
│  Push to master → Triggers workflow         │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│         GitHub Actions Runner               │
│         (ubuntu-latest VM)                  │
│                                             │
│  1. Checkout code                           │
│  2. az login (service principal)            │
│  3. az storage blob upload-batch            │
│     → Uploads to $web container             │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│   Azure Blob Storage — $web container       │
│                                             │
│   index.html (updated)                      │
│   css/styles.css (updated)                  │
│   js/main.js (updated)                      │
└─────────────────┬───────────────────────────┘
                  │
                  ▼  (next visitor request)
┌─────────────────────────────────────────────┐
│         Azure CDN (cache invalidated        │
│         on next origin request)             │
└─────────────────────────────────────────────┘
```

---

## 11. Security Architecture

### 11.1 Security Layers Overview

```
┌──────────────────────────────────────────────────────────┐
│  LAYER 1: Transport Security                             │
│  HTTPS everywhere (TLS 1.2+)                            │
│  HTTP → HTTPS redirect enforced at CDN                  │
└──────────────────────────────────────────────────────────┘
                          │
┌──────────────────────────────────────────────────────────┐
│  LAYER 2: Network / CORS                                 │
│  CORS: Azure Function only accepts cunyuslabs.com       │
│  Blob Storage: not directly accessible to end users     │
│  (CDN is the only public entrypoint)                    │
└──────────────────────────────────────────────────────────┘
                          │
┌──────────────────────────────────────────────────────────┐
│  LAYER 3: Identity & Access Management                   │
│  Service principal scoped to one storage account only   │
│  Function App has its own Managed Identity              │
│  GitHub Secrets: credentials encrypted at rest           │
└──────────────────────────────────────────────────────────┘
                          │
┌──────────────────────────────────────────────────────────┐
│  LAYER 4: Data Security                                  │
│  Cosmos DB connection string: App Settings only          │
│  No credentials in source code or git history           │
│  Azure encrypts all storage and DB data at rest          │
└──────────────────────────────────────────────────────────┘
```

### 11.2 Secret Management Detail

| Secret | Where It Lives | Who Can Access It | Rotation Needed? |
|---|---|---|---|
| Azure service principal JSON | GitHub Secrets | GitHub Actions only | On compromise or team changes |
| Cosmos DB connection string | Azure App Settings | Azure Function runtime only | On compromise or key rotation |
| Storage account key | GitHub Secrets | GitHub Actions only | On compromise |
| Route 53 credentials | AWS IAM (not in this repo) | N/A | Standard rotation policy |

**What is NOT in the repository:**
- No connection strings
- No account keys
- No passwords or API tokens
- No `.env` files (`.gitignore` excludes them)

### 11.3 Service Principal — Least Privilege

The GitHub Actions service principal (`sp-cloudresume-github`) was created with:
- **Role**: Storage Blob Data Contributor (or Contributor scoped to the storage account)
- **Scope**: The single storage account, not the entire subscription or resource group

This follows the **Principle of Least Privilege**: if the service principal credentials were ever leaked, an attacker could only modify files in the `$web` container of that one storage account — they could not access Cosmos DB, Function App configuration, or any other resources.

### 11.4 HTTPS Enforcement

- Azure CDN is configured to redirect all HTTP requests to HTTPS
- The Azure CDN managed certificate is valid for `cunyuslabs.com` and auto-renews before expiration
- TLS 1.0 and 1.1 are disabled — only TLS 1.2+ is accepted
- The Blob Storage static website endpoint (HTTP-only) is not publicly advertised and only accessible to the CDN

### 11.5 Protecting Against Common Attacks

| Attack | How We Mitigate It |
|---|---|
| **Credential theft** | Secrets in GitHub Secrets / Azure App Settings, never in code |
| **CORS abuse (counter inflation)** | CORS allows only `cunyuslabs.com` origin |
| **Man-in-the-middle** | HTTPS everywhere; TLS 1.2+ enforced |
| **DDoS on Function** | Azure Functions Consumption plan auto-throttles; CDN absorbs static file requests |
| **SQL/NoSQL injection** | No user input reaches the database; counter only reads a hardcoded document ID |
| **Clickjacking** | Can add `X-Frame-Options: DENY` header via CDN rules |
| **Content tampering** | CI/CD deploys from git; files are version-controlled |
| **Unauthorized Azure access** | Service principal scoped to minimum required resources |

### 11.6 Future Security Improvements

- [ ] Add **Azure API Management** in front of the Function to enforce rate limiting, API keys, and request/response logging
- [ ] Switch Function App to **Managed Identity** → eliminate the Cosmos DB connection string from App Settings entirely
- [ ] Add **Security headers** via Azure CDN rules: `Content-Security-Policy`, `X-Frame-Options`, `X-XSS-Protection`, `Strict-Transport-Security`
- [ ] Enable **Cosmos DB firewall** to only accept connections from the Function App's outbound IPs

---

## 12. Cost Management & Budget Monitoring

### 12.1 Cost Breakdown

| Service | Pricing Model | Estimated Monthly Cost |
|---|---|---|
| Azure Blob Storage | ~$0.018/GB/month + $0.004/10k operations | **< $1** (tiny site) |
| Azure CDN | $0.081/GB transferred (first 10 TB) | **< $1** (low traffic) |
| Azure Functions | 1M free executions/month; then $0.20/million | **$0** (under free tier) |
| Azure Cosmos DB | Free tier: 1,000 RU/s + 25 GB | **$0** (under free tier) |
| AWS Route 53 | $0.50/hosted zone + $12/year domain | **~$1.50/month** |
| GitHub Actions | Free for public repos | **$0** |
| **Total Estimated** | | **~$2–3/month** |

### 12.2 Azure Cost Management Setup

1. Navigate to **Azure Portal** → **Cost Management + Billing** → **Budgets** → **+ Add**
2. Configure:
   - **Scope**: Resource group `rg-cloudresume`
   - **Budget amount**: $10/month (generous buffer above expected $2-3)
   - **Alert conditions**: 80% of budget ($8) and 100% ($10)
   - **Alert recipients**: Your email address
3. Azure will email you when spending reaches these thresholds

### 12.3 AWS Cost Monitoring

1. Navigate to **AWS Console** → **Billing** → **Budgets** → **Create a budget**
2. Choose **Cost budget**
3. Set monthly budget: $2 (Route 53 only resource used)
4. Add email alert at 80% and 100%

### 12.4 Free Tier Monitoring

Both Azure and AWS offer free tiers for new accounts:
- **Azure**: 12-month free services + always-free services (Functions, Cosmos DB free tier)
- **AWS**: 12-month free for some services; Route 53 is not free-tier eligible

Key always-free services used:
- Azure Functions: 1 million free executions/month
- Azure Cosmos DB: 1,000 RU/s + 25 GB (free tier, one account)

> **Warning**: Cosmos DB free tier is only available on one account per Azure subscription. If you've already used it elsewhere, regular pricing applies.

### 12.5 Cost Optimization Tips Applied

| Decision | Cost Impact |
|---|---|
| Serverless (Consumption plan) for Functions | No cost when idle; ~$0 at low traffic |
| LRS (not GRS) for Blob Storage | 60% cheaper than geo-redundant; CDN provides availability |
| CDN caching | Reduces origin (storage) requests and bandwidth |
| Same Azure region for all resources | No cross-region bandwidth charges |
| Cosmos DB Serverless capacity mode | Pay per RU consumed, not provisioned |

---

## 13. High Availability Design

### 13.1 Availability by Layer

| Layer | SLA | How High Availability Is Achieved |
|---|---|---|
| Azure Blob Storage (LRS) | 99.9% | 3 synchronous copies within one datacenter |
| Azure CDN | 99.9% | Hundreds of global PoPs; edge caching means origin downtime = cache serving |
| Azure Functions (Consumption) | 99.95% | Managed by Microsoft; auto-scales from 0 to thousands of instances |
| Azure Cosmos DB | 99.99% | Multi-master replication; optional multi-region writes |
| AWS Route 53 | 100% | Anycast routing across 100+ global DNS servers |

### 13.2 CDN as a High Availability Layer

The CDN is the most important HA component for the frontend. If Azure Blob Storage experiences an outage:
- CDN edge nodes continue serving **cached content** from their local cache
- The resume page remains available to visitors worldwide
- The only visible impact would be if the CDN cache expires during an outage, after which visitors would see errors

This means our effective uptime for the static content is higher than the storage account's 99.9% SLA — the CDN extends availability into the "storage is down but users still see the page" scenario.

### 13.3 Graceful Degradation

The visitor counter is the one component that requires the Function and Cosmos DB to be available. If either goes down:

```javascript
// js/main.js
} catch (err) {
    console.warn('Visitor counter unavailable:', err.message);
    counterEl.textContent = '—';  // Shows '—' instead of crashing
}
```

The page continues to load and function normally. The visitor counter gracefully degrades to showing `—`. This is intentional — a visitor counter outage should never prevent someone from viewing the resume.

### 13.4 Multi-Region Considerations

**Current state**: Single-region deployment (East US 2 for all Azure resources)

**What happens in a datacenter outage?**
- Blob Storage (LRS): Content is unavailable (no geo-redundancy)
- Functions: Azure auto-fails over within the region for Consumption plan
- Cosmos DB: With free tier, single-region; data is unavailable if region is down

**Upgrade path for higher availability**:

| Upgrade | Benefit | Cost Impact |
|---|---|---|
| Blob Storage LRS → GRS | Automatic failover to paired region | +$0.01/GB/month |
| Cosmos DB → Multi-region | Reads from nearest region, writes replicated globally | +$0.08/RU/100 |
| Function App → two regions + Traffic Manager | Automatic routing to healthy region | +$18/month (Traffic Manager) |

For a personal resume site, the current single-region setup is appropriate. The cost of multi-region redundancy exceeds the risk of the infrequent datacenter events.

---

## 14. Architectural Weaknesses & Mitigations

### 14.1 Weakness Matrix

| Weakness | Severity | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| No rate limiting on counter API | Medium | Medium | Counter inflation, cost spike | Azure API Management or Function-level throttle |
| CDN cache not purged on deploy | Low | High | Visitors see stale content after deploy | Activate the CDN purge step in the CI/CD workflow |
| Single Azure region | Medium | Low | Outage if East US 2 has an incident | Enable GRS on storage; add Cosmos DB geo-replication |
| Service principal key in GitHub Secrets | Low | Low | Key leak = storage write access | Rotate keys; consider Workload Identity Federation |
| No WAF (Web Application Firewall) | Medium | Low | Bot traffic, DDoS reaching origin | Azure Front Door (includes WAF) instead of CDN |
| Cosmos DB no firewall | Low | Low | DB accessible from any Azure IP | Restrict to Function App outbound IPs |
| No health monitoring / alerting | Low | High | Outages go unnoticed | Set up Azure Monitor alerts on HTTP 5xx errors |
| No content hash in asset filenames | Low | High | Browser/CDN caches stale CSS/JS | Implement build step with asset hashing |
| Counter inflated by web crawlers/bots | Low | High | Inaccurate visit count | Filter User-Agent in Function code; use Application Insights |

### 14.2 Critical Weakness: No CDN Cache Purge on Deploy

**Problem**: When new code is pushed, the GitHub Actions workflow uploads files to Blob Storage but does not purge the CDN cache. Visitors hitting an edge node that cached `styles.css` an hour ago will continue to see the old CSS even though the origin has the new file.

**Fix** (already in the workflow, just uncomment and add secrets):
```yaml
- name: Purge Azure CDN endpoint
  uses: azure/CLI@v2
  with:
    inlineScript: |
      az cdn endpoint purge \
        --resource-group ${{ secrets.AZURE_RG }} \
        --profile-name ${{ secrets.AZURE_CDN_PROFILE }} \
        --name ${{ secrets.AZURE_CDN_ENDPOINT }} \
        --content-paths '/*'
```

### 14.3 Medium Weakness: No API Rate Limiting

**Problem**: The Azure Function `POST /api/counter` endpoint is publicly accessible. A script running in a loop could send thousands of requests per minute, artificially inflating the visitor count and potentially incurring Function and Cosmos DB costs.

**Fix options** (in order of complexity):

1. **Quick fix**: Add a check in the Function code that validates the `Origin` header (limited effectiveness — can be spoofed with curl)
2. **Better fix**: Add Azure API Management (APIM) in front of the Function with rate limiting rules (100 requests/IP/minute)
3. **Best fix**: Use Azure Front Door with WAF policies — blocks bot traffic, provides rate limiting, and replaces Azure CDN in one service

### 14.4 Medium Weakness: No Monitoring or Alerting

**Problem**: If the Function App crashes or the Cosmos DB becomes unavailable, there is no automated alert. The outage is discovered when someone notices the `—` in the visitor counter.

**Fix**: Set up Azure Application Insights:
1. Enable Application Insights on the Function App
2. Create an alert rule: "If HTTP 5xx errors > 5 in 5 minutes, email pcunyus@gmail.com"
3. Create an availability test: "Ping /api/counter every 5 minutes; alert if 3 consecutive failures"

### 14.5 Low-Risk Weakness: Workload Identity Federation (Service Principal Rotation)

**Problem**: The `AZURE_CREDENTIALS` GitHub Secret contains a client secret that expires (typically 1 or 2 years). If it expires, CI/CD breaks silently.

**Better solution**: Use **Workload Identity Federation** — GitHub Actions can authenticate to Azure using an OIDC token without any stored secret. There is no password to expire or rotate.

```yaml
# Replaces the creds: ${{ secrets.AZURE_CREDENTIALS }} approach
- uses: azure/login@v2
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

This approach eliminates the long-lived secret entirely.

---

## 15. Infrastructure Diagrams

### 15.1 Full Architecture — Network Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              INTERNET                                        │
│                                                                              │
│   User in New York        User in London         User in Tokyo               │
│        │                       │                       │                     │
└────────┼───────────────────────┼───────────────────────┼─────────────────────┘
         │                       │                       │
         │                       │    DNS Lookup:        │
         └───────────────────────┴── cunyuslabs.com ────┘
                                          │
                                          ▼
                              ┌─────────────────────┐
                              │    AWS Route 53      │
                              │  (authoritative DNS) │
                              │                      │
                              │  cunyuslabs.com      │
                              │  CNAME →             │
                              │  cunyuslabs.         │
                              │  azureedge.net       │
                              └──────────┬───────────┘
                                         │
                         ┌───────────────┼───────────────┐
                         │               │               │
                         ▼               ▼               ▼
                   ┌──────────┐   ┌──────────┐   ┌──────────┐
                   │ Azure CDN│   │ Azure CDN│   │ Azure CDN│
                   │ PoP: NYC │   │ PoP: LON │   │ PoP: TYO │
                   │ (cached) │   │ (cached) │   │ (cached) │
                   └────┬─────┘   └────┬─────┘   └────┬─────┘
                        │              │               │
                        │     Cache MISS (only)        │
                        └──────────────┼───────────────┘
                                       │
                                       ▼
                          ┌────────────────────────┐
                          │  Azure Blob Storage     │
                          │  (Static Website)       │
                          │  East US 2              │
                          │                         │
                          │  $web/                  │
                          │  ├─ index.html          │
                          │  ├─ css/styles.css      │
                          │  └─ js/main.js          │
                          └────────────────────────┘
```

### 15.2 Visitor Counter — Data Flow

```
Browser (any location)
         │
         │  Page loads → JS executes
         │
         │  POST https://cunyuslabs-api.azurewebsites.net/api/counter
         │  Header: Origin: https://cunyuslabs.com
         │
         ▼
┌────────────────────────────────────────────────────────┐
│              Azure Functions                           │
│              (Consumption Plan, East US 2)             │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Function: counter (HTTP Trigger, POST)          │  │
│  │                                                  │  │
│  │  1. Validate CORS Origin header                  │  │
│  │  2. Open Cosmos DB connection                    │  │
│  │     (using COSMOS_DB_CONNECTION_STRING           │  │
│  │      from App Settings)                          │  │
│  │  3. Read document: id = "visitors"               │  │
│  │  4. count = count + 1                            │  │
│  │  5. Write updated document                       │  │
│  │  6. Return: { "count": N }                       │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────┬───────────────────────────────┘
                         │  Azure internal network
                         ▼
┌────────────────────────────────────────────────────────┐
│              Azure Cosmos DB                           │
│              (NoSQL / Core SQL API, East US 2)         │
│                                                        │
│  Account: cunyuslabs-cosmos                            │
│  Database: VisitorDB                                   │
│  Container: Counters                                   │
│  Document: { "id": "visitors", "count": N }            │
│                                                        │
│  Consistency: Session                                  │
│  Capacity: Serverless                                  │
│  Free Tier: Active (1,000 RU/s + 25 GB)               │
└────────────────────────────────────────────────────────┘
         │
         │  Response: { "count": N+1 }
         ▼
Browser updates footer: "Visitors: 143"
         │
         │  animateCounter() — counts up from 0 over 1.5s
         ▼
Visitor sees animated counter reach 143
```

### 15.3 CI/CD Pipeline — Deployment Flow

```
┌──────────────────┐     git push      ┌──────────────────────┐
│  Developer Local │ ────────────────► │   GitHub Repository  │
│  Workstation     │                   │   (master branch)    │
└──────────────────┘                   └──────────┬───────────┘
                                                  │
                                       Webhook: push event
                                                  │
                                                  ▼
                                       ┌──────────────────────┐
                                       │  GitHub Actions       │
                                       │  Workflow triggered   │
                                       │  (ubuntu-latest)      │
                                       │                       │
                                       │  ┌─────────────────┐  │
                                       │  │ Step 1:         │  │
                                       │  │ Checkout code   │  │
                                       │  └────────┬────────┘  │
                                       │           │           │
                                       │  ┌────────▼────────┐  │
                                       │  │ Step 2:         │  │
                                       │  │ Azure Login     │  │
                                       │  │ (svc principal) │  │
                                       │  └────────┬────────┘  │
                                       │           │           │
                                       │  ┌────────▼────────┐  │
                                       │  │ Step 3:         │  │
                                       │  │ Upload to       │  │
                                       │  │ $web container  │  │
                                       │  └────────┬────────┘  │
                                       └───────────┼───────────┘
                                                   │
                                      az storage blob upload-batch
                                                   │
                                                   ▼
                                       ┌──────────────────────┐
                                       │  Azure Blob Storage  │
                                       │  $web container      │
                                       │  (files updated)     │
                                       └──────────────────────┘
                                                   │
                                       (next CDN cache miss)
                                                   │
                                                   ▼
                                       ┌──────────────────────┐
                                       │  Azure CDN           │
                                       │  (serves new content │
                                       │   after cache TTL)   │
                                       └──────────────────────┘
```

### 15.4 Security Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    THREAT BOUNDARY                          │
│                                                             │
│  Attacker                                                   │
│    │                                                        │
│    ├── Tries to call /api/counter from evil.com             │
│    │     → BLOCKED by CORS policy                          │
│    │                                                        │
│    ├── Tries to access Blob Storage directly (HTTP)         │
│    │     → Served (public files) but no HTTPS              │
│    │     → CDN enforces HTTPS redirect                     │
│    │                                                        │
│    ├── Tries to exfiltrate GitHub Secrets                   │
│    │     → Secrets never logged; masked in workflow output  │
│    │                                                        │
│    ├── Tries to access Azure with leaked SP credentials     │
│    │     → Scoped only to $web container writes             │
│    │                                                        │
│    └── Tries to read Cosmos DB connection string            │
│          → Only in Azure App Settings (encrypted at rest)  │
│          → Not in code, not in git history                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    TRUST ZONES                              │
│                                                             │
│  PUBLIC (Anyone can access)                                 │
│  ├── https://cunyuslabs.com (CDN → Blob Storage)           │
│  └── POST https://cunyuslabs-api.../api/counter            │
│        (rate: unthrottled; improvement: add rate limiting) │
│                                                             │
│  GITHUB (Repo owner + GitHub Actions)                      │
│  ├── AZURE_CREDENTIALS (service principal JSON)            │
│  ├── AZURE_STORAGE_ACCOUNT_NAME                            │
│  └── AZURE_RG                                              │
│                                                             │
│  AZURE INTERNAL (Azure services only)                      │
│  ├── Cosmos DB connection string (App Settings)            │
│  ├── Cosmos DB account (no public internet firewall yet)   │
│  └── Storage account key (via auth-mode key in CI/CD)     │
└─────────────────────────────────────────────────────────────┘
```

### 15.5 Resource Group Map

```
Azure Resource Group: rg-cloudresume (East US 2)
│
├── Storage Account: cunyuslabsresume
│     ├── $web container (public)
│     │     ├── index.html
│     │     ├── css/styles.css
│     │     └── js/main.js
│     └── Static website endpoint: https://cunyuslabsresume.z13.web.core.windows.net
│
├── CDN Profile: cunyuslabs-cdn-profile (Standard Microsoft)
│     └── Endpoint: cunyuslabs.azureedge.net
│           ├── Custom domain: cunyuslabs.com
│           ├── HTTPS: Enabled (managed certificate)
│           └── Origin: cunyuslabsresume storage static website
│
├── Function App: cunyuslabs-api
│     ├── Runtime: Python 3.11
│     ├── Plan: Consumption (serverless)
│     ├── App Settings:
│     │     ├── COSMOS_DB_CONNECTION_STRING (encrypted)
│     │     ├── COSMOS_DB_DATABASE_NAME
│     │     └── COSMOS_DB_CONTAINER_NAME
│     └── Function: counter (HTTP trigger, POST /api/counter)
│
└── Cosmos DB Account: cunyuslabs-cosmos
      ├── Free tier: Active
      ├── Consistency: Session
      ├── Capacity: Serverless
      └── Database: VisitorDB
            └── Container: Counters
                  └── Document: { "id": "visitors", "count": N }

AWS Account:
└── Route 53 Hosted Zone: cunyuslabs.com
      ├── NS records (4 authoritative nameservers)
      ├── CNAME: cunyuslabs.com → cunyuslabs.azureedge.net
      ├── CNAME: www.cunyuslabs.com → cunyuslabs.azureedge.net
      └── CNAME: (ACM validation records x2)

GitHub Repository: CloudResume (frontend)
└── .github/workflows/frontend-ci-cd.yml
      └── Secrets:
            ├── AZURE_CREDENTIALS
            ├── AZURE_STORAGE_ACCOUNT_NAME
            └── AZURE_RG
```

---

## 16. Issues Encountered & Changes Made

### 16.1 Branch Name Mismatch

**Problem**: The initial workflow triggered on `main` branch, but the repository uses `master`.

**Symptom**: Pushes to `master` did not trigger the CI/CD workflow. Deployments had to be done manually.

**Fix**: Updated the workflow trigger from `branches: [main]` to `branches: [master]`:

```yaml
on:
  push:
    branches: [master]   # was: [main]
```

**Lesson**: GitHub no longer auto-creates `main` as the default branch for all repos. Always verify the default branch name before writing workflow triggers.

### 16.2 API URL Not Pointing to Live Function

**Problem**: The JavaScript initially had the API URL pointing to a placeholder. After the Azure Function was deployed, the URL needed to be updated.

**Fix**: Updated `js/main.js` line 8 from the placeholder to the live Function App URL:

```javascript
// Before
const API_BASE_URL = 'https://YOUR_FUNCTION_APP.azurewebsites.net/api';

// After
const API_BASE_URL = 'https://cunyuslabs-api.azurewebsites.net/api';
```

**Lesson**: Hardcoding the API URL in the frontend is a simplification appropriate for a single-environment personal project. A production app would use environment variables injected at build time, or an API Gateway URL that doesn't change between environments.

### 16.3 ACM Certificate vs. Azure CDN Certificate

**Problem**: During the initial DNS setup, an AWS ACM certificate was provisioned for `cunyuslabs.com` and `www.cunyuslabs.com`. ACM certificates cannot be used with Azure CDN — they are scoped to AWS services only.

**Symptom**: After pointing the domain to Azure CDN, the HTTPS certificate served was Azure's DigiCert managed certificate, not the ACM certificate. The ACM cert became unused.

**Fix**: Azure CDN was configured to provision its own managed certificate automatically when the custom domain was added. The Route 53 ACM validation CNAME records remain in place (harmless) but the ACM certificate is not used.

**Lesson**: When mixing cloud providers for DNS and hosting, carefully research which certificate authority each service uses. Azure CDN manages its own certificates; you cannot import external certificates into the standard tier (you can with Azure Front Door Premium + customer-managed certificates).

### 16.4 CDN Cache Purge Not Automated

**Problem**: After early deploys, some team members reported seeing the old version of the page despite the deploy completing successfully.

**Cause**: The CDN was serving its cached version of `index.html` which had a short but non-zero TTL.

**Current state**: The CDN purge step is commented out in the workflow pending addition of CDN profile/endpoint secrets.

**Fix** (to be implemented): Add `AZURE_CDN_PROFILE` and `AZURE_CDN_ENDPOINT` as GitHub Secrets, then uncomment the CDN purge step in the workflow.

### 16.5 Cosmos DB Connection — Initial 403 Error

**Problem**: The Azure Function returned a 403 Forbidden error from Cosmos DB on initial deployment.

**Cause**: The Cosmos DB connection string in Application Settings was incorrect — it was missing the port number and was using the wrong key (read-only key instead of read-write).

**Fix**: Retrieved the primary read-write connection string from **Cosmos DB Account → Keys → Primary Connection String** and updated the Application Setting.

**Lesson**: Cosmos DB has both read-only and read-write keys. Always use read-write for operations that need to write. Consider the principle of least privilege — if a future feature only reads, use the read-only key for that connection.

---

## 17. Lessons Learned & What I Would Do Differently

### 17.1 What Worked Well

| Decision | Why It Worked |
|---|---|
| Azure Functions + Cosmos DB for visitor counter | Genuinely zero cost at this traffic level; auto-scales |
| GitHub Actions for CI/CD | Simple YAML, fast execution, good secret management |
| CDN in front of Blob Storage | Dramatically better performance; free HTTPS |
| Graceful degradation on counter failure | Resume page always works, even if the API is down |
| All Azure resources in one resource group | Easy to see cost, easy to manage permissions, easy to delete |
| Keeping DNS in Route 53 | No disruption risk from domain transfer; 100% SLA |

### 17.2 What I Would Do Differently

| What | Better Approach | Reason |
|---|---|---|
| Service principal in GitHub Secrets | Workload Identity Federation (OIDC) | No long-lived secret; eliminates rotation risk |
| Hardcoded API URL in JS | Environment-specific config or Azure CDN custom headers | Easier to manage staging vs. production |
| No asset hashing | Webpack/Vite build with content-hash filenames | Enables long CDN cache TTLs without stale content risk |
| Azure CDN Standard | Azure Front Door | Front Door includes WAF, rate limiting, health probes, and failover — better for a "professional" architecture |
| No monitoring | Application Insights from day one | Easier to debug; tracks real visitor metrics vs. just a counter |
| Single region | Storage GRS + Cosmos DB multi-region | Trivial cost increase; significant reliability improvement |

### 17.3 Why the Cloud Resume Challenge Is Valuable

This project demonstrates:

1. **You can wire together real cloud services** — not just click through tutorials; you debugged real issues (wrong connection strings, branch name mismatches, CDN caching)
2. **You understand security** — credentials never in code, least-privilege service principals, HTTPS everywhere, CORS scoped to your domain
3. **You understand cost** — every service was chosen with cost consciousness; the site runs for ~$2-3/month
4. **You understand CI/CD** — every git push automatically deploys; the workflow is documented and reproducible
5. **You can explain your reasoning** — this document exists

The challenge forces you to connect security, networking, compute, databases, DNS, and CI/CD into a coherent system — exactly the kind of thinking expected of a cloud engineer.

---

*Document generated: May 2026 | Stack version: Azure Functions (Python 3.11), Cosmos DB NoSQL, Azure CDN Standard Microsoft, GitHub Actions*
