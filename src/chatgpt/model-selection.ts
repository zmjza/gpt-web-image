import type { Page } from "playwright-core";

export const DAILY_IMAGE_LIMIT_MESSAGE = "单日生图已达限额，暂时不可生图。";
export const MODEL_PRIORITY = ["gpt-5.6-sol-high", "gpt-5.6-sol-medium", "instant"] as const;
export type ImageModelKey = (typeof MODEL_PRIORITY)[number];

export interface ModelOptionSnapshot {
  modelKey: ImageModelKey;
  label: string;
  available: boolean;
  selected: boolean;
  locatorIndex?: number;
}

export interface ModelSelectionEvidence {
  modelKey: ImageModelKey;
  label: string;
  priority: number;
  selectedAt: string;
}

export class ModelSelectionError extends Error {
  public constructor(public readonly code: "DAILY_IMAGE_LIMIT_REACHED" | "MODEL_SELECTION_UNCERTAIN", message: string) { super(message); }
}

export function classifyModelLabel(label: string): ImageModelKey | null {
  const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
  const matches = new Set<ImageModelKey>();
  if (/极速|instant|fast/.test(normalized)) matches.add("instant");
  if (/(gpt\s*[- ]?5\.6|5\.6)\s*[- ]?sol/.test(normalized)) {
    if (/高|high/.test(normalized)) matches.add("gpt-5.6-sol-high");
    if (/中|medium/.test(normalized) || !/高|high/.test(normalized)) matches.add("gpt-5.6-sol-medium");
  }
  return matches.size === 1 ? [...matches][0] ?? null : null;
}

export function choosePreferredModel(options: readonly ModelOptionSnapshot[]): ModelOptionSnapshot & { modelKey: ImageModelKey } {
  const known = new Map<ImageModelKey, ModelOptionSnapshot>();
  for (const option of options) {
    const current = known.get(option.modelKey);
    if (!current || option.available || option.selected) known.set(option.modelKey, option);
  }
  for (const modelKey of MODEL_PRIORITY) {
    const candidate = known.get(modelKey);
    if (candidate?.available) return candidate;
  }
  if (MODEL_PRIORITY.every((modelKey) => known.has(modelKey) && !known.get(modelKey)?.available)) {
    throw new ModelSelectionError("DAILY_IMAGE_LIMIT_REACHED", DAILY_IMAGE_LIMIT_MESSAGE);
  }
  throw new ModelSelectionError("MODEL_SELECTION_UNCERTAIN", "无法确定 ChatGPT 当前可用的生图模型，已停止提交。");
}

interface DomModelControl {
  label: string;
  modelKey: ImageModelKey | null;
  available: boolean;
  selected: boolean;
  hasSubmenu: boolean;
  domIndex?: number;
}

interface CapabilityPickerSnapshot {
  groupIndex: number;
  min: number;
  max: number;
  current: number;
  disabled: boolean;
  explicitLimit: boolean;
  text: string;
}

function capabilityModel(value: number): ImageModelKey | null {
  if (value === 2) return "gpt-5.6-sol-high";
  if (value === 1) return "gpt-5.6-sol-medium";
  if (value === 0) return "instant";
  return null;
}

function capabilityLabel(modelKey: ImageModelKey): string {
  if (modelKey === "gpt-5.6-sol-high") return "GPT-5.6 Sol 高";
  if (modelKey === "gpt-5.6-sol-medium") return "GPT-5.6 Sol 中";
  return "极速";
}

async function readCapabilityPicker(page: Page): Promise<CapabilityPickerSnapshot | null> {
  const groups = page.locator('[role="group"]');
  const snapshots = await groups.evaluateAll((nodes) => nodes.map((node, groupIndex) => {
    const element = node as HTMLElement;
    const style = window.getComputedStyle(element);
    const text = (element.textContent || "").replace(/\s+/g, " ").trim();
    const slider = element.querySelector('[role="slider"]') as HTMLElement | null;
    const control = element.querySelector('[role="menuitem"][aria-label*="能力"], [role="menuitem"][aria-label*="capability" i]') as HTMLElement | null;
    if (!slider || style.display === "none" || style.visibility === "hidden" || element.getClientRects().length === 0) return null;
    const min = Number(slider.getAttribute("aria-valuemin"));
    const max = Number(slider.getAttribute("aria-valuemax"));
    const current = Number(slider.getAttribute("aria-valuenow"));
    const disabled = slider.getAttribute("aria-disabled") === "true"
      || control?.getAttribute("aria-disabled") === "true"
      || element.getAttribute("aria-disabled") === "true";
    return {
      groupIndex,
      min,
      max,
      current,
      disabled,
      explicitLimit: /不可用|unavailable|not available|已达上限|限额|daily limit/i.test(text),
      text
    };
  })) as Array<CapabilityPickerSnapshot | null>;
  const candidates = snapshots.filter((snapshot): snapshot is CapabilityPickerSnapshot => snapshot !== null
    && /(?:gpt\s*[- ]?5\.6|5\.6)\s*[- ]?sol/i.test(snapshot.text)
    && /(?:思考|推理)强度|thinking|reasoning/i.test(snapshot.text));
  if (candidates.length > 1) throw new ModelSelectionError("MODEL_SELECTION_UNCERTAIN", "ChatGPT 存在多个可见能力选择器，已停止提交。");
  return candidates[0] ?? null;
}

async function readVisibleModelControls(page: Page): Promise<ModelOptionSnapshot[]> {
  const locator = page.locator('[role="option"], [role="menuitem"], [data-model]');
  const rawControls = await locator.evaluateAll((nodes) => nodes.map((node, domIndex) => {
    const element = node as HTMLElement;
    const style = window.getComputedStyle(element);
    const label = element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "";
    const visible = style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    if (!visible) return null;
    const explicitlyDisabled = element.hasAttribute("disabled")
      || element.getAttribute("aria-disabled") === "true"
      || element.getAttribute("data-disabled") === "true"
      || element.getAttribute("data-available") === "false"
      || /不可用|unavailable|not available|已达上限|限额|disabled/i.test(label);
    return {
      label: label.replace(/\s+/g, " ").trim(),
      modelKey: null,
      available: !explicitlyDisabled,
      selected: element.getAttribute("aria-selected") === "true" || element.getAttribute("aria-checked") === "true" || element.getAttribute("data-selected") === "true",
      hasSubmenu: element.getAttribute("aria-haspopup") === "menu" || element.hasAttribute("data-has-submenu") || element.hasAttribute("aria-expanded"),
      domIndex
    };
  })) as unknown as Array<DomModelControl | null>;
  const controls = rawControls.filter((control): control is DomModelControl => control !== null);
  return controls.flatMap((control, locatorIndex) => {
    if (control.hasSubmenu) return [];
    const modelKey = classifyModelLabel(control.label);
    return modelKey ? [{ ...control, modelKey, locatorIndex: control.domIndex ?? locatorIndex }] : [];
  });
}

async function openCapabilitySubmenu(page: Page): Promise<boolean> {
  const submenuSelector = '[role="menuitem"][aria-haspopup="menu"], [role="menuitem"][data-has-submenu], [role="menuitem"][aria-expanded]';
  const menus = page.locator('[role="menu"]');
  const menuSnapshots = await menus.evaluateAll((nodes, selector) => nodes.map((node, index) => {
    const element = node as HTMLElement;
    const style = window.getComputedStyle(element);
    const submenuLabels = Array.from(element.querySelectorAll(selector as string)).map((submenu) => (
      submenu.getAttribute("aria-label") || submenu.getAttribute("title") || submenu.textContent || ""
    ).replace(/\s+/g, " ").trim());
    return {
      index,
      visible: style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0,
      relevant: submenuLabels.some((label) => /模型|model|gpt|sol|能力|capability|极速|instant/i.test(label))
    };
  }), submenuSelector);
  const relevantMenus = menuSnapshots.filter((entry) => entry.visible && entry.relevant);
  if (relevantMenus.length > 1) throw new ModelSelectionError("MODEL_SELECTION_UNCERTAIN", "ChatGPT 存在多个可见模型菜单，已停止提交。");
  const menu = relevantMenus[0];
  if (!menu) return false;
  const locator = menus.nth(menu.index).locator(submenuSelector);
  const candidates = await locator.evaluateAll((nodes) => nodes.map((node, index) => {
    const element = node as HTMLElement;
    const style = window.getComputedStyle(element);
    const label = element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "";
    return {
      index,
      label: label.replace(/\s+/g, " ").trim(),
      visible: style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0,
      enabled: !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true"
    };
  }));
  const matches = candidates.filter((entry) => entry.visible && entry.enabled
    && /模型|model|gpt|sol|能力|capability|极速|instant/i.test(entry.label));
  if (matches.length > 1) throw new ModelSelectionError("MODEL_SELECTION_UNCERTAIN", "ChatGPT 存在多个可见模型能力子菜单，已停止提交。");
  const candidate = matches[0];
  if (!candidate) return false;
  const control = locator.nth(candidate.index);
  await control.focus();
  await control.press("Enter");
  return true;
}

async function openModelMenu(page: Page): Promise<boolean> {
  const buttons = page.getByRole("button");
  const candidates = await buttons.evaluateAll((nodes) => nodes.map((node, index) => {
    const element = node as HTMLElement;
    const label = element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "";
    const style = window.getComputedStyle(element);
    return {
      index,
      label: label.replace(/\s+/g, " ").trim(),
      visible: style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0,
      hasMenu: element.getAttribute("aria-haspopup") === "menu"
    };
  }));
  const candidate = candidates.find((entry) => entry.visible
    && !/send|submit|发送/i.test(entry.label)
    && (/模型|model|gpt|sol|极速|instant/i.test(entry.label)
      || (entry.hasMenu && /^(?:高|中|极速|high|medium|instant|fast)$/i.test(entry.label))));
  if (!candidate) return false;
  await buttons.nth(candidate.index).click();
  return true;
}

async function selectionIsConfirmed(page: Page, modelKey: ImageModelKey): Promise<boolean> {
  const controls = await readVisibleModelControls(page);
  if (controls.some((control) => control.modelKey === modelKey && control.selected)) return true;
  const triggerText = await page.locator('button[aria-haspopup="menu"], button[aria-label*="模型" i], button[aria-label*="model" i]').evaluateAll((nodes) => nodes.map((node) => node.textContent || node.getAttribute("aria-label") || "")).catch(() => [] as string[]);
  return triggerText.some((text) => classifyModelLabel(text) === modelKey);
}

export async function selectImageModel(page: Page, timeoutMs: number, pollIntervalMs = 100): Promise<ModelSelectionEvidence> {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  let controls = await readVisibleModelControls(page);
  let capability = await readCapabilityPicker(page);
  let menuOpened = controls.length > 0 || capability !== null;
  let capabilitySubmenuOpened = false;
  while (controls.length === 0 && !capability && Date.now() < deadline) {
    if (!menuOpened) menuOpened = await openModelMenu(page);
    if (menuOpened && !capabilitySubmenuOpened) capabilitySubmenuOpened = await openCapabilitySubmenu(page);
    await page.waitForTimeout(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
    controls = await readVisibleModelControls(page);
    capability = await readCapabilityPicker(page);
  }
  if (capability) {
    if (capability.disabled) {
      if (capability.explicitLimit) throw new ModelSelectionError("DAILY_IMAGE_LIMIT_REACHED", DAILY_IMAGE_LIMIT_MESSAGE);
      throw new ModelSelectionError("MODEL_SELECTION_UNCERTAIN", "ChatGPT 能力选择器当前不可交互，已停止提交。");
    }
    if (capability.min !== 0 || !Number.isInteger(capability.max) || capability.max < 0 || capability.max > 2) {
      throw new ModelSelectionError("MODEL_SELECTION_UNCERTAIN", "ChatGPT 能力选择器范围不明确，已停止提交。");
    }
    const targetValue = capability.max;
    const modelKey = capabilityModel(targetValue);
    if (!modelKey) throw new ModelSelectionError("MODEL_SELECTION_UNCERTAIN", "ChatGPT 能力选择器值无法识别，已停止提交。");
    const group = page.locator('[role="group"]').nth(capability.groupIndex);
    const control = group.locator('[role="menuitem"][aria-label*="能力"], [role="menuitem"][aria-label*="capability" i]');
    if (await control.count() !== 1 || !(await control.isVisible()) || !(await control.isEnabled())) {
      throw new ModelSelectionError("MODEL_SELECTION_UNCERTAIN", "ChatGPT 能力选择器缺少可交互控件，已停止提交。");
    }
    if (capability.current !== targetValue) await control.press("End");
    await page.waitForTimeout(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
    const confirmed = await readCapabilityPicker(page);
    const expectedThinking = modelKey === "gpt-5.6-sol-high" ? /(?:思考|推理)强度\s*高|thinking\s*(?:level\s*)?high/i
      : modelKey === "gpt-5.6-sol-medium" ? /(?:思考|推理)强度\s*中|thinking\s*(?:level\s*)?medium/i
      : /极速|instant|fast/i;
    if (!confirmed || confirmed.current !== targetValue || !expectedThinking.test(confirmed.text)) {
      throw new ModelSelectionError("MODEL_SELECTION_UNCERTAIN", "ChatGPT 未确认能力选择器的目标模型，已停止提交。");
    }
    return { modelKey, label: capabilityLabel(modelKey), priority: MODEL_PRIORITY.indexOf(modelKey) + 1, selectedAt: new Date().toISOString() };
  }
  if (controls.length === 0) throw new ModelSelectionError("MODEL_SELECTION_UNCERTAIN", "ChatGPT 模型菜单结构不明确，已停止提交。");
  const selected = choosePreferredModel(controls);
  if (selected.locatorIndex === undefined) throw new ModelSelectionError("MODEL_SELECTION_UNCERTAIN", "ChatGPT 模型控件缺少可验证定位，已停止提交。");
  const optionLocator = page.locator('[role="option"], [role="menuitem"], [data-model]').nth(selected.locatorIndex);
  await optionLocator.focus();
  await optionLocator.press("Enter");
  const confirmed = await page.waitForFunction(({ key, deadlineAt }) => {
    if (Date.now() > deadlineAt) return false;
    const controls = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], [data-model]'));
    return controls.some((node) => {
      const element = node as HTMLElement;
      const label = element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "";
      const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
      const isTarget = key === "instant" ? /极速|instant|fast/.test(normalized) : /(gpt\s*[- ]?5\.6|5\.6)\s*[- ]?sol/.test(normalized) && (key === "gpt-5.6-sol-high" ? /高|high/.test(normalized) : !/高|high/.test(normalized));
      return isTarget && (element.getAttribute("aria-selected") === "true" || element.getAttribute("aria-checked") === "true" || element.getAttribute("data-selected") === "true");
    });
  }, { key: selected.modelKey, deadlineAt: deadline }).catch(() => undefined);
  if (!confirmed && !(await selectionIsConfirmed(page, selected.modelKey))) {
    throw new ModelSelectionError("MODEL_SELECTION_UNCERTAIN", "ChatGPT 未确认已选择目标生图模型，已停止提交。");
  }
  return { modelKey: selected.modelKey, label: selected.label, priority: MODEL_PRIORITY.indexOf(selected.modelKey) + 1, selectedAt: new Date().toISOString() };
}
