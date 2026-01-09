# Hostinger Auto-Deploy Setup

## Prerequisites
- GitHub repository
- Hostinger hosting with SSH access

## Setup Steps

### 1. Generate Deploy Key
```bash
ssh-keygen -t ed25519 -f /tmp/hostinger_deploy -N "" -C "github-actions-deploy"
```

### 2. Add Public Key to Hostinger
1. Hostinger → Hosting → Advanced → SSH Access
2. Add contents of `/tmp/hostinger_deploy.pub`

### 3. Add Private Key to GitHub
```bash
gh secret set SSH < /tmp/hostinger_deploy
```

### 4. Create Workflow File
Create `.github/workflows/deploy-hostinger.yml`:

```yaml
name: Deploy Frontend to Hostinger

on:
  push:
    branches:
      - main
    paths-ignore:
      - 'api/**'
      - '*.md'
      - '.gitignore'

jobs:
  deploy:
    name: Deploy to Hostinger
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup SSH
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.SSH }}" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          ssh-keyscan -p 65002 145.79.4.36 >> ~/.ssh/known_hosts 2>/dev/null || true

      - name: Deploy via rsync
        run: |
          rsync -avz --delete \
            -e "ssh -p 65002 -o StrictHostKeyChecking=no -o ConnectTimeout=30" \
            --exclude='.git' \
            --exclude='.github' \
            --exclude='.claude' \
            --exclude='.env*' \
            --exclude='api' \
            --exclude='node_modules' \
            --exclude='*.md' \
            --exclude='Dockerfile' \
            --exclude='package*.json' \
            --exclude='Archive.zip' \
            --exclude='*.sh' \
            ./ u837303424@145.79.4.36:/home/u837303424/domains/YOUR_DOMAIN/public_html/
```

### 5. Update for Your Project
Replace in the workflow:
- `YOUR_DOMAIN` → your domain name
- `145.79.4.36` → your Hostinger server IP
- `65002` → your SSH port
- `u837303424` → your Hostinger username
- Adjust `--exclude` patterns as needed

## Prompt for Claude Code

> Set up auto-deploy to Hostinger using the pattern in HOSTINGER_DEPLOY.md
