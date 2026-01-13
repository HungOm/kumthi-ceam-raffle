# CEAM Raffle - Test Deployment Guide

This guide will help you deploy and test the new version with the "Reset Connection" feature.

## 📁 File Structure

```
CEAM-raffle/
├── index.html                          # Production version (stable)
├── docs/
│   └── test.html                       # Test version (new features)
├── GoogleAppsScript_v2_test.gs         # Google Apps Script for backend
└── DEPLOYMENT_GUIDE.md                 # This file
```

## 🚀 Deployment Steps

### Step 1: Deploy Google Apps Script

1. **Open your Google Sheet**
   - Go to your CEAM Raffle spreadsheet

2. **Open Apps Script Editor**
   - Click `Extensions` → `Apps Script`

3. **Replace the code**
   - Select all existing code and delete it
   - Copy the entire contents of `GoogleAppsScript_v2_test.gs`
   - Paste it into the Apps Script editor

4. **Save the script**
   - Click the save icon (💾) or press `Ctrl+S` / `Cmd+S`
   - Name it: `CEAM Raffle API v2`

5. **Deploy as Web App**
   - Click `Deploy` → `New deployment`
   - Click the gear icon ⚙️ next to "Select type"
   - Choose `Web app`
   - Configure settings:
     - **Description**: `CEAM Raffle Test Deployment`
     - **Execute as**: `Me (your-email@gmail.com)`
     - **Who has access**: `Anyone` ⚠️ **IMPORTANT**
   - Click `Deploy`

6. **Authorize the script**
   - Click `Authorize access`
   - Choose your Google account
   - Click `Advanced` → `Go to CEAM Raffle API (unsafe)`
   - Click `Allow`

7. **Copy the Web App URL**
   - After deployment, you'll see a URL like:
     ```
     https://script.google.com/macros/s/AKfycbz.../exec
     ```
   - **COPY THIS URL** - you'll need it!

### Step 2: Test the Application

#### Option A: Test Locally (Recommended for Development)

1. **Open the test file directly in browser**
   ```bash
   # Navigate to the project folder
   cd /Users/hungom/Desktop/CEAM-raffle
   
   # Open test.html directly (bypasses CORS issues)
   open docs/test.html
   # or on Windows: start docs/test.html
   # or on Linux: xdg-open docs/test.html
   ```

2. **Enter the Web App URL**
   - When the page loads, you'll see the connection setup screen
   - Paste the Web App URL you copied earlier
   - Click `Connect & Check Access`

3. **Authorize in browser if needed**
   - If you see "Authorization Required", click the blue button
   - Sign in with your Google account
   - Come back to the test page and click "Connect" again

#### Option B: Deploy to GitHub Pages (Recommended for Testing)

1. **Commit and push to GitHub**
   ```bash
   git add .
   git commit -m "Add test deployment with reset connection feature"
   git push origin test-deployment
   ```

2. **Enable GitHub Pages**
   - Go to your GitHub repository
   - Click `Settings` → `Pages`
   - Under "Source", select `test-deployment` branch
   - Under "Folder", select `/ (root)` or `/docs`
   - Click `Save`

3. **Access the test page**
   - GitHub will provide a URL like:
     ```
     https://yourusername.github.io/CEAM-raffle/docs/test.html
     ```
   - Open this URL in your browser

#### Option C: Use Live Server (May have CORS issues)

⚠️ **Note**: This method may encounter CORS errors because Google Apps Script has restrictions on localhost origins.

1. **Start Live Server**
   - If using VS Code with Live Server extension
   - Right-click on `docs/test.html`
   - Select "Open with Live Server"

2. **If you get CORS errors**
   - The error message will guide you to authorize the script
   - Click the authorization link
   - Then try option A or B instead

## 🔧 Troubleshooting

### CORS Error (Failed to fetch)

**Symptoms**: 
```
Access to fetch at 'https://script.google.com/...' has been blocked by CORS policy
```

**Solutions**:
1. **Open the file directly** (Option A above) - This bypasses CORS
2. **Deploy to GitHub Pages** (Option B above) - GitHub Pages is whitelisted
3. **Authorize the script first**:
   - Open this URL in a new tab: `YOUR_WEB_APP_URL?action=ping`
   - Sign in and authorize
   - Go back to your test page and try again

### "Access Denied" Message

**Symptoms**: You see a red ❌ "Access Denied" screen

**Solutions**:
1. **Check Staff Sheet**:
   - Open your Google Sheet
   - Go to the "Staff" tab
   - Make sure your email is in Column A
   - Make sure "Active" is `TRUE` in Column D

2. **Try the new "Try Different URL" button**:
   - Click the orange `🔌 Try Different URL` button
   - Re-enter your Web App URL
   - This will reset the connection

### Deployment Settings Wrong

**Symptoms**: Script doesn't work at all, or keeps asking for authorization

**Check these settings**:
1. In Apps Script deployment:
   - ✅ Execute as: **Me** (not "User accessing the web app")
   - ✅ Who has access: **Anyone** (not "Only myself")
2. Redeploy with a new version if you changed settings

## ✨ New Features in Test Version

### 1. Reset Connection Feature
- **"Try Different URL" button** on Access Denied screen
- **"Try different deployment URL" link** on Access Granted screen  
- **Enhanced Disconnect** - automatically shows URL input after disconnect
- Allows testing multiple deployments without clearing browser data

### 2. Better Error Messages
- Enhanced CORS error handling with detailed instructions
- Step-by-step guidance for authorization
- Clear explanations of deployment settings issues

### 3. Improved UX
- Auto-focus on URL input field after reset
- Confirmation dialogs explain what will happen
- Toast notifications for better feedback

## 📝 Testing Checklist

- [ ] Deploy Google Apps Script with correct settings
- [ ] Copy Web App URL
- [ ] Open test.html (via file://, GitHub Pages, or Live Server)
- [ ] Enter Web App URL and connect
- [ ] Authorize if prompted
- [ ] Verify access is granted
- [ ] Test "Try different deployment URL" feature
- [ ] Test disconnect and reconnect
- [ ] Verify data loads correctly
- [ ] Test ticket operations (if authorized)

## 🔄 Switching Between Deployments

### To test a different deployment:

1. **Method 1: Use the Reset Button**
   - Click `🔌 Try Different URL` (on Access Denied screen)
   - Or click `🔌 Try different deployment URL` (on Access Granted screen)
   - Enter the new Web App URL

2. **Method 2: Use Disconnect**
   - In the dashboard, click `❌ Disconnect` in the sync bar
   - The URL input screen will appear automatically
   - Enter the new Web App URL

3. **Method 3: Clear Browser Data** (old way, not recommended)
   - Open browser DevTools (F12)
   - Go to Application → Local Storage
   - Delete `ceam_apps_script_url`
   - Refresh the page

## 📊 Comparing Test vs Production

| Feature | index.html (Production) | docs/test.html (Test) |
|---------|------------------------|----------------------|
| Reset Connection | ❌ No | ✅ Yes |
| Try Different URL | ❌ No | ✅ Yes |
| Enhanced CORS Errors | ❌ No | ✅ Yes |
| Auto-focus URL Input | ❌ No | ✅ Yes |
| Better Disconnect Flow | ❌ No | ✅ Yes |

## 🎯 Next Steps

1. **Test thoroughly** using docs/test.html
2. **Verify all features work** as expected
3. **If everything works**, merge to main:
   ```bash
   git checkout main
   git merge test-deployment
   git push origin main
   ```
4. **Update production** by copying test.html to index.html

## 📞 Support

If you encounter issues:
1. Check the browser console (F12) for detailed error messages
2. Review the troubleshooting section above
3. Verify your Google Apps Script deployment settings
4. Make sure your email is in the Staff sheet with Active = TRUE

---

**Happy Testing! 🎉**
