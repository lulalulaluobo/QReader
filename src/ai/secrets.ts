import type { AiProvider, AiSettings } from "./providers";

/** Optional API since Obsidian 1.11.4; older hosts can still read legacy config. */
export interface SecretStorageAccess {
  getSecret(id: string): string | null;
  setSecret(id: string, value: string): void;
}
const providers: AiProvider[] = ["deepseek", "agnes", "custom"];
function key(ai: AiSettings, provider: AiProvider): string {
  return provider === "custom" ? ai.custom.apiKey : provider === "deepseek" ? ai.deepseekApiKey : ai.agnesApiKey;
}
function setKey(ai: AiSettings, provider: AiProvider, value: string): void {
  if (provider === "custom") ai.custom.apiKey = value;
  else if (provider === "deepseek") ai.deepseekApiKey = value;
  else ai.agnesApiKey = value;
}

export class AiSecrets {
  constructor(private storage?: SecretStorageAccess) {}
  get supported(): boolean { return !!this.storage?.getSecret && !!this.storage?.setSecret; }
  hydrate(ai: AiSettings): void {
    if (!this.supported) return;
    const values: [AiProvider, string][] = [];
    for (const provider of providers) {
      const id = ai.secretIds[provider];
      if (id) values.push([provider, this.storage!.getSecret(id) ?? key(ai, provider)]);
    }
    // A partial read must not expose some keys as legacy plaintext or clear others.
    for (const [provider, value] of values) setKey(ai, provider, value);
  }
  /** Verify each write before producing the plaintext-free settings snapshot. */
  snapshot(ai: AiSettings): AiSettings {
    const saved = structuredClone(ai);
    if (!this.supported) return saved;
    for (const provider of providers) {
      const value = key(ai, provider);
      if (!value && !ai.secretIds[provider]) continue;
      const id = ai.secretIds[provider] ?? `qreader-${provider}-api-key`;
      this.storage!.setSecret(id, value);
      const verified = this.storage!.getSecret(id);
      if (verified !== value && !(value === "" && verified === null)) throw new Error("密钥存储校验失败，原配置已保留");
      saved.secretIds[provider] = id;
      setKey(saved, provider, "");
    }
    return saved;
  }
}
