# Deployment Guide

## GitHub Setup

### 1. Create GitHub Repository

1. Go to https://github.com/new
2. Fill in the repository details:
   - **Repository name**: `sewer-lateral-inspection` (or your preferred name)
   - **Description**: "Next.js application for processing sewer asset GeoJSON and NASSCO MDB inspection data to create lateral inspection layers"
   - **Visibility**: Choose Public or Private
   - **DO NOT** initialize with README, .gitignore, or license (we already have these)
3. Click "Create repository"

### 2. Push Code to GitHub

After creating the repository, run these commands (replace `YOUR_USERNAME` and `REPO_NAME` with your actual values):

```bash
# Add the remote repository
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git

# Push code to GitHub
git branch -M main
git push -u origin main
```

Or if you prefer SSH:

```bash
git remote add origin git@github.com:YOUR_USERNAME/REPO_NAME.git
git branch -M main
git push -u origin main
```

## Vercel Deployment

### 1. Sign Up / Sign In to Vercel

1. Go to https://vercel.com
2. Sign up or sign in with your GitHub account (recommended for easy integration)

### 2. Import Your GitHub Repository

1. Click "Add New..." → "Project"
2. Import your GitHub repository
3. Vercel will automatically detect it's a Next.js project

### 3. Configure Environment Variables

In the Vercel project settings:

1. Go to **Settings** → **Environment Variables**
2. Add the following variables:

   - **Name**: `NEXT_PUBLIC_MAPBOX_TOKEN`
   - **Value**: Your Mapbox public token (starts with `pk.`)
   - **Environment**: Production, Preview, Development (select all)

   - **Name**: `MAPBOX_ACCESS_TOKEN` (optional)
   - **Value**: Your Mapbox access token (if you have one for server-side)
   - **Environment**: Production, Preview, Development (select all)

3. Click "Save"

### 4. Deploy

1. Click "Deploy" button
2. Vercel will automatically:
   - Build your Next.js application
   - Deploy it to a live URL (e.g., `your-project.vercel.app`)
   - Set up automatic deployments for future pushes to GitHub

### 5. Automatic Deployments

- Every push to the `main` branch will automatically trigger a new deployment
- Pull requests will create preview deployments
- You can view deployment status in the Vercel dashboard

## Post-Deployment

### Verify Deployment

1. Visit your Vercel URL
2. Test the application:
   - Upload a GeoJSON file
   - Upload an MDB file
   - Process the data
   - Verify the map displays correctly

### Custom Domain (Optional)

1. Go to **Settings** → **Domains**
2. Add your custom domain
3. Follow Vercel's DNS configuration instructions

## Troubleshooting

### Build Errors

- Check the Vercel build logs in the deployment page
- Ensure all environment variables are set correctly
- Verify `package.json` has all required dependencies

### Map Not Displaying

- Verify `NEXT_PUBLIC_MAPBOX_TOKEN` is set correctly in Vercel
- Check browser console for errors
- Ensure the token has the correct scopes in Mapbox account

### MDB Processing Issues

- Note: MDB processing requires `mdbtools` to be installed
- This works locally but may not work on Vercel serverless functions
- Consider using a different approach for MDB parsing in production (e.g., convert MDB to JSON first)

