#!/bin/bash
# ═══════════════════════════════════════════════════
# Layer Lama — One-shot GitHub + Netlify setup script
# Run this in your terminal after downloading index.html
# ═══════════════════════════════════════════════════

echo "🦙 Layer Lama Setup Script"
echo "=========================="
echo ""

# Step 1: Create project folder
echo "📁 Creating project folder..."
mkdir -p ~/layerlama-site/images
cd ~/layerlama-site

# Step 2: Check if index.html exists
if [ ! -f "index.html" ]; then
    echo ""
    echo "⚠️  index.html not found in ~/layerlama-site/"
    echo "   Please copy the downloaded index.html file here first."
    echo "   Then re-run this script."
    echo ""
    echo "   On Mac:  cp ~/Downloads/index.html ~/layerlama-site/"
    echo "   On Win:  copy %USERPROFILE%\\Downloads\\index.html %USERPROFILE%\\layerlama-site\\"
    exit 1
fi

echo "✅ index.html found"

# Step 3: Initialize git
echo "🔧 Initializing git..."
git init
git add .
git commit -m "Initial commit — Layer Lama 3D Print Portfolio"

# Step 4: Create GitHub repo using GitHub CLI
echo ""
echo "🐙 Creating GitHub repository..."
if command -v gh &> /dev/null; then
    gh repo create layerlama-site --public --source=. --remote=origin --push
    echo "✅ Repo created and pushed!"
else
    echo ""
    echo "⚠️  GitHub CLI (gh) not installed."
    echo "   Install it first:"
    echo ""
    echo "   Mac:     brew install gh"
    echo "   Windows: winget install --id GitHub.cli"
    echo "   Linux:   sudo apt install gh"
    echo ""
    echo "   Then run:  gh auth login"
    echo "   Then re-run this script."
    echo ""
    echo "   OR manually create the repo at https://github.com/new"
    echo "   Then run:"
    echo "     git remote add origin https://github.com/YOUR_USERNAME/layerlama-site.git"
    echo "     git branch -M main"
    echo "     git push -u origin main"
    exit 1
fi

# Step 5: Netlify setup
echo ""
echo "🚀 Next steps:"
echo "   1. Go to https://app.netlify.com"
echo "   2. Click 'Add new site' → 'Import an existing project'"
echo "   3. Select 'Deploy with GitHub'"
echo "   4. Choose 'layerlama-site' repo"
echo "   5. Leave build command blank, set publish directory to: ."
echo "   6. Click 'Deploy site'"
echo ""
echo "   Then: Domain management → Add custom domain → layerlama.com"
echo "   Then: Forms → contact → Add email notification → hello@layerlama.com"
echo ""
echo "🦙 Done! Your site will auto-deploy on every git push."
