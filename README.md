Structured Product Dashboard: Railway setup
Who can do what
`https://YOUR-DOMAIN/` : everyone views the latest published data. No upload controls are shown.
`https://YOUR-DOMAIN/admin` : the upload page. Publishing needs the ADMIN password, which is checked on the server.
Deploy
Put this folder (`server.js`, `package.json`, `public/`, `.gitignore`) in a GitHub repo and create a Railway project from it.
In Railway, open the service, then Variables, and add:
`ADMIN_PASSWORD` : a long password only you know
`VIEWER_PASSWORD` : the password you give to viewers (strongly recommended, otherwise anyone with the link can see client data)
`DATA_DIR` = `/data`
Service, then Volumes, then add a volume mounted at `/data`. Without it, the uploaded data is erased every time Railway redeploys.
Settings, then Networking, then add your custom domain. Railway provides HTTPS.
Weekly use
Open `/admin`, enter the admin password, choose the Excel file. Once it says the dashboard is ready, viewers see the new data on their next refresh. Each upload replaces the previous one.
