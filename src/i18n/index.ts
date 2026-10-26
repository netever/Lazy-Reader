// Interface texts live in JSON files, one per language. Only Russian for now (docs/SPEC.md).
import ru from "./ru.json";

type Key = keyof typeof ru;

export function t(key: Key, params: Record<string, string | number> = {}): string {
  return ru[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
