import { Webhook } from "standardwebhooks";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TIMESTAMP_AGE_SECONDS = 5 * 60;
const DISCORD_ROLE_ID_PATTERN = /^\d{17,20}$/;
const BATCH_MAX_EVENTS = 20;
const BATCH_MAX_DESCRIPTION = 3900;
const STRING_EVENTS = new Set([
	"String added",
	"String added in the repository",
	"String added in the upload",
	"Source string added",
	"Source string added in the repository",
	"Source string added in the upload",
]);

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/") {
			return json({ service: "Weblate to Discord webhook", status: "ok" });
		}

		if (url.pathname !== "/webhook") {
			return json({ error: "Not found" }, 404);
		}

		if (request.method !== "POST") {
			return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
		}

		if (!env.WEBHOOK_SECRET || !env.DISCORD_WEBHOOK_URL) {
			return json({ error: "Webhook is not configured" }, 503);
		}

		const contentLength = Number(request.headers.get("content-length"));
		if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
			return json({ error: "Payload too large" }, 413);
		}

		const rawBody = await request.text();
		if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
			return json({ error: "Payload too large" }, 413);
		}

		try {
			const timestamp = request.headers.get("webhook-timestamp");
			if (!isFreshTimestamp(timestamp)) {
				return json({ error: "Webhook timestamp is invalid or expired" }, 400);
			}

			const verifier = new Webhook(env.WEBHOOK_SECRET);
			verifier.verify(rawBody, {
				"webhook-id": request.headers.get("webhook-id"),
				"webhook-timestamp": timestamp,
				"webhook-signature": request.headers.get("webhook-signature"),
			});
		}
		catch (error) {
			console.warn("Rejected Weblate webhook", error.message);
			return json({ error: "Invalid webhook signature or payload" }, 401);
		}

		let event;
		try {
			event = JSON.parse(rawBody);
		}
		catch {
			return json({ error: "Invalid JSON payload" }, 400);
		}

		if (!event || typeof event !== "object" || Array.isArray(event)) {
			return json({ error: "Invalid event payload" }, 400);
		}

		if (!STRING_EVENTS.has(event.action)) {
			return json({ status: "ignored", reason: "Event is not a new string" });
		}

		const eventId = request.headers.get("webhook-id");
		const response = await env.STRING_EVENT_BATCHER.get(
			env.STRING_EVENT_BATCHER.idFromName("weblate-string-events"),
		).fetch("https://batcher.internal/enqueue", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Event-Id": eventId },
			body: JSON.stringify(minimizeEvent(event, env)),
		});

		if (!response.ok) {
			console.error("Failed to queue Weblate event", response.status);
			return json({ error: "Unable to queue notification" }, 503);
		}

		return json({ status: "queued" }, 202);
	},
};

export class StringEventBatcher {
	constructor(state, env) {
		this.state = state;
		this.env = env;
	}

	async fetch(request) {
		if (request.method !== "POST" || new URL(request.url).pathname !== "/enqueue") {
			return json({ error: "Not found" }, 404);
		}

		const eventId = request.headers.get("X-Event-Id");
		let event;
		try {
			event = await request.json();
		}
		catch {
			return json({ error: "Invalid event" }, 400);
		}

		if (!eventId || !event || typeof event !== "object" || Array.isArray(event)) {
			return json({ error: "Invalid event" }, 400);
		}

		let result = "queued";
		let isFirstQueuedEvent = false;
		await this.state.storage.transaction(async (transaction) => {
			const queue = await transaction.get("queue") || [];
			if (queue.some((item) => item.id === eventId)) {
				result = "duplicate";
				return;
			}

			if (queue.length >= 500) {
				result = "full";
				return;
			}

			isFirstQueuedEvent = queue.length === 0;
			queue.push({ id: eventId, event });
			await transaction.put("queue", queue);
		});

		if (result === "full") {
			return json({ error: "Notification queue is full" }, 503);
		}

		if (isFirstQueuedEvent) {
			await this.state.storage.setAlarm(Date.now() + 7000);
		}
		return json({ status: result }, 202);
	}

	async alarm() {
		const queue = await this.state.storage.get("queue") || [];
		if (queue.length === 0) {
			return;
		}

		const batch = createDiscordBatch(queue, this.env);
		const response = await fetch(this.env.DISCORD_WEBHOOK_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(batch.payload),
		});

		if (!response.ok) {
			console.error("Discord webhook failed", response.status);
			await this.state.storage.setAlarm(Date.now() + 30000);
			return;
		}

		const sentIds = new Set(batch.items.map((item) => item.id));
		await this.state.storage.transaction(async (transaction) => {
			const currentQueue = await transaction.get("queue") || [];
			await transaction.put("queue", currentQueue.filter((item) => !sentIds.has(item.id)));
		});

		const remaining = await this.state.storage.get("queue");
		if (remaining?.length) {
			await this.state.storage.setAlarm(Date.now() + 1000);
		}
	}
}

function isFreshTimestamp(value) {
	if (!value || !/^\d+(\.\d+)?$/.test(value)) {
		return false;
	}

	const timestamp = Number(value);
	const now = Date.now() / 1000;
	return Number.isFinite(timestamp) && Math.abs(now - timestamp) <= MAX_TIMESTAMP_AGE_SECONDS;
}

function formatDiscordEmbed(event, env, number) {
	const project = safeText(event.project, "Unknown project");
	const key = safeText(event.context, "(key not provided)");
	const link = event.link || "";
	const linkedKey = link
		? `[\`${escapeCode(key)}\`](${escapeMarkdownUrl(link)})`
		: `\`${escapeCode(key)}\``;

	return {
		description: `${number}. ${escapeMarkdown(project)}: ${linkedKey}`,
	};
}

function minimizeEvent(event, env) {
	return {
		project: safeText(event.project, "Unknown project"),
		context: safeText(event.context || event.source, "(key not provided)"),
		link: getWeblateLink(event.url, env.WEBLATE_URL),
	};
}

function createDiscordBatch(queue, env) {
	const roleId = DISCORD_ROLE_ID_PATTERN.test(env.DISCORD_ROLE_ID || "")
		? env.DISCORD_ROLE_ID
		: null;
	const items = [];
	const embeds = [];
	let descriptionLength = 0;

	for (const item of queue.slice(0, BATCH_MAX_EVENTS)) {
		const embed = formatDiscordEmbed(item.event, env, items.length + 1);
		const nextLength = descriptionLength + embed.description.length + (embeds.length ? 1 : 0);
		if (nextLength > BATCH_MAX_DESCRIPTION) {
			break;
		}

		embeds.push(embed);
		items.push(item);
		descriptionLength = nextLength;
	}

	return {
		items,
		payload: {
			content: roleId ? `<@&${roleId}>` : "",
			embeds: embeds.length ? [{ description: embeds.map((embed) => embed.description).join("\n") }] : [],
			allowed_mentions: {
				parse: [],
				roles: roleId ? [roleId] : [],
			},
		},
	};
}

function safeText(value, fallback) {
	const text = Array.isArray(value) ? value.join(" / ") : value;
	if (typeof text !== "string" || !text.trim()) {
		return fallback;
	}

	return text.replace(/[\r\n]+/g, " ").slice(0, 500);
}

function escapeCode(value) {
	return value.replace(/`/g, "\\`");
}

function escapeMarkdown(value) {
	return value.replace(/([\\_*~|])/g, "\\$1");
}

function escapeMarkdownUrl(value) {
	return value.replace(/[()\\]/g, (character) => encodeURIComponent(character));
}

function getWeblateLink(value, baseUrl) {
	if (typeof value !== "string" || !value.trim()) {
		return "";
	}

	try {
		const base = baseUrl ? new URL(baseUrl) : null;
		const link = new URL(value, base || undefined);
		if (link.protocol !== "https:" && link.protocol !== "http:") {
			return "";
		}

		if (base && link.origin !== base.origin) {
			return "";
		}

		return link.href;
	}
	catch {
		return "";
	}
}

function json(body, status = 200, headers = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			...headers,
		},
	});
}
