import { sendDigestEmail } from "../email/index";
import type { ChangeLogEntry } from "../types";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export interface DigestJobResult {
	changeCount: number;
	emailSent: boolean;
}

interface DbReader {
	getRecentChanges(since: Date): ChangeLogEntry[];
}

export async function runDigestJob(db: DbReader): Promise<DigestJobResult> {
	const since = new Date(Date.now() - TWENTY_FOUR_HOURS_MS);
	const changes = db.getRecentChanges(since);

	if (changes.length === 0) {
		console.log("digest: skipped — no changes in the last 24 hours");
		return { changeCount: 0, emailSent: false };
	}

	try {
		await sendDigestEmail(changes);
		console.log(`digest: sent — ${changes.length} change(s) reported`);
		return { changeCount: changes.length, emailSent: true };
	} catch (error) {
		console.error("digest: failed to send email", error);
		return { changeCount: changes.length, emailSent: false };
	}
}
