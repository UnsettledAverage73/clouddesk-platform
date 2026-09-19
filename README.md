# CloudDesk Platform ⚡

Cloud Workstation management portal and in-browser desktop streaming platform.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/UnsettledAverage73/clouddesk-platform)

---

## 🚀 1-Click Deployment on Render

1. Click the **Deploy to Render** button above or go to [dashboard.render.com](https://dashboard.render.com).
2. Choose **New +** > **Web Service** and select `UnsettledAverage73/clouddesk-platform`.
3. Add the following **Environment Variables** in the Render settings:
   - `AWS_REGION`: `us-east-1`
   - `AWS_ACCESS_KEY_ID`: Your AWS Access Key ID
   - `AWS_SECRET_ACCESS_KEY`: Your AWS Secret Access Key
   - `AWS_SESSION_TOKEN`: Your AWS Session Token (for Learner Lab / temporary credentials)
   - `INSTANCE_TAG`: `AWS-Cloud-Desktop`
4. Click **Deploy**. Your platform will be live at `https://<your-subdomain>.onrender.com`!

---

## 💻 Local Development

```bash
# Install dependencies
npm install

# Start development server
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.
