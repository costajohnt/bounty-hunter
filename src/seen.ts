import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { SeenIssue } from "./types.js";

export class SeenStore {
  private path: string;
  private data: Map<string, SeenIssue>;

  constructor(path: string) {
    this.path = path;
    this.data = new Map();
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    const raw = JSON.parse(readFileSync(this.path, "utf-8")) as SeenIssue[];
    for (const issue of raw) {
      this.data.set(issue.id, issue);
    }
  }

  private save(): void {
    writeFileSync(this.path, JSON.stringify([...this.data.values()], null, 2));
  }

  private makeId(repo: string, number: number): string {
    return `${repo}#${number}`;
  }

  hasSeen(repo: string, number: number): boolean {
    return this.data.has(this.makeId(repo, number));
  }

  markSeen(issue: SeenIssue): void {
    this.data.set(issue.id, issue);
    this.save();
  }

  markSkipped(repo: string, number: number): void {
    const id = this.makeId(repo, number);
    this.data.set(id, {
      id,
      repo,
      number,
      title: "",
      seen_at: new Date().toISOString(),
      skipped: true,
    });
    this.save();
  }
}
