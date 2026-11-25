# Weblate to Discord

A Cloudflare Worker that forwards Weblate new-string events to a Discord channel.

**Requirements:** Node.js/npm, a Cloudflare account with Workers enabled, a Discord server and channel, and a Weblate project or component where you can manage add-ons.

## 1. Set up local build

1. Install dependencies from the project root:

   ```sh
   npm ci
   ```
2. Create a `.dev.vars` file in the project root with the runtime secrets:

   ```dotenv
   WEBHOOK_SECRET=whsec_<base64-secret>
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>
   DISCORD_ROLE_ID=<optional-discord-role-id>
   WEBLATE_URL=https://translate.example.com
   ```

   The Weblate webhook secret must be base64 encoded and represent 24–64 bytes. Use the exact same value in Weblate and `.dev.vars`. `WEBLATE_URL` is the Weblate instance's origin and is used to resolve relative string URLs. Each notification uses the project slug from that webhook event, so no project-name variable is needed.
3. Start the local Worker:

   ```sh
   npm run dev
   ```

   The webhook endpoint is `http://localhost:8787/webhook`. The root URL (`http://localhost:8787/`) is a health check. Use `npm run lint` to lint the project.

## 2. Set up production

1. In Cloudflare **[Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)**, create a Worker and connect it to the GitHub repository.
2. Configure the build:
   - Root directory: `/`
   - Build command: empty
   - Deploy command: `npm run deploy`
   - Preview builds: disabled
3. Deploy. Cloudflare assigns the Worker a public `workers.dev` URL (get it from Settings → Domains). The Weblate endpoint is that URL followed by `/webhook`.
4. Set the production runtime secrets `WEBLATE_URL`, `WEBHOOK_SECRET`, `DISCORD_WEBHOOK_URL`, and (optionally) `DISCORD_ROLE_ID` in the Worker's **Settings → Runtime variables and secrets**. Mark all of them as secrets.
5. Install and configure Weblate's **Webhook** add-on (`weblate.webhook.webhook`) under **Manage → Add-ons** in the Administration menu. Use the following settings:
   - **Webhook URL:** `https://<worker-name>.<account>.workers.dev/webhook`
   - **Webhook secret:** use the same value as `WEBHOOK_SECRET`.
   - **Change events to trigger:** choose **Translation content events**.

The Worker accepts signed `POST` requests only at `/webhook`, rejects payloads over 1 MiB and timestamps older than five minutes.

### Changing Ownership
For someone else to take over the Worker, they need to fork the repository, then follow the setup instructions from step 2. Then they can update the Weblate add-on with the new webhook URL and secret. Don't forget to delete the old Discord webhook (don't reuse the old one for safety reasons).