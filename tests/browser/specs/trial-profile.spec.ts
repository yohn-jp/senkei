import { expect, test, type Page } from "@playwright/test";

async function openOwnedTrial(page: Page) {
  await page.getByTestId("nav-next").click();
  await page.getByText("Local ownership and runtime", { exact: true }).click();
  const enable = page.getByRole("button", { name: "Enable test-only owned runtime", exact: true });
  if (await enable.isVisible()) await enable.click();
  await expect(page.getByRole("status").filter({ hasText: "Test-only six-domain runtime enabled" })).toBeVisible({ timeout: 60_000 });
  return page.getByRole("region", { name: "Owned Heroes and local assets" });
}

async function checkReady(page: Page) {
  await page.getByRole("button", { name: "検証・コンパイル", exact: true }).click();
  await expect(page.getByTestId("preflight-status")).toHaveText("開始可能", { timeout: 60_000 });
}

async function editJinreiFromReady(page: Page, width: number) {
  const ready = page.getByTestId("journey-ready");
  if (width < 761) await ready.getByRole("button", { name: /^Jinrei/ }).click();
  else await ready.getByRole("button", { name: "Jinreiを変更", exact: true }).click();
}

async function openProfile(page: Page) {
  const panel = page.locator("#next-panel-jinrei");
  const disclosure = panel.locator("details").filter({ has: page.locator('section[aria-label="Trial Behavior Profile editor"]') });
  if (await disclosure.getAttribute("open") === null) await disclosure.locator("summary").click();
  const editor = page.getByRole("region", { name: "Trial Behavior Profile editor" });
  await expect(editor).toBeVisible();
  return editor;
}

for (const width of [1440, 390]) {
  test(`trial preferences review, owner binding and recovery at ${width}px`, async ({ page }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    const owned = await openOwnedTrial(page);
    await owned.getByRole("button", { name: "Obtain trial roster" }).click();
    for (let index = 1; index <= 5; index++) {
      const select = owned.getByRole("combobox", { name: `Slot slot-0${index}`, exact: true });
      await expect.poll(() => select.locator("option").count()).toBeGreaterThan(5);
      const id = await select.locator("option").nth(index).getAttribute("value");
      expect(id).toBeTruthy();
      await select.selectOption(id!);
    }
    await page.getByLabel("Trial tick limit").fill("3");
    await page.locator("#next-tab-jinrei").click();
    const initialEditor = await openProfile(page);
    await initialEditor.getByRole("combobox", { name: "Profile scope" }).selectOption("hero");
    const initialHero = (await initialEditor.getByRole("combobox", { name: "Hero", exact: true }).locator("option:checked").textContent())!.trim();
    await expect(initialEditor.getByRole("textbox", { name: `Hero ${initialHero} targeting`, exact: true })).toBeDisabled();
    await expect(initialEditor).toContainText("Hero preferences require a current owner-authorized Run");
    await page.getByRole("button", { name: "準備確認へ", exact: true }).click();
    await checkReady(page);
    await editJinreiFromReady(page, width);
    let editor = await openProfile(page);
    await editor.getByRole("combobox", { name: "Profile scope" }).selectOption("army");

    await editor.getByRole("textbox", { name: "Army navigation", exact: true }).fill("0");
    await editor.getByRole("combobox", { name: "Profile scope" }).selectOption("squad");
    const squad = await editor.getByRole("combobox", { name: "Squad", exact: true }).inputValue();
    const squadInput = editor.getByRole("textbox", { name: `Squad ${squad} navigation`, exact: true });
    await expect(squadInput).toBeEnabled({ timeout: 30_000 });
    await squadInput.fill("-2");
    await editor.getByRole("button", { name: "Review preferences", exact: true }).click();
    let review = editor.getByRole("region", { name: "Review trial preferences" });
    await expect(review).toContainText("Army · navigation: Inherit → 0");
    await expect(review).toContainText(`Squad ${squad} · navigation: Inherit → -2`);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await review.getByRole("button", { name: "Cancel review", exact: true }).click();
    await expect(squadInput).toHaveValue("");
    await editor.getByRole("combobox", { name: "Profile scope" }).selectOption("army");
    await expect(editor.getByRole("textbox", { name: "Army navigation", exact: true })).toHaveValue("");

    await editor.getByRole("textbox", { name: "Army navigation", exact: true }).fill("0");
    await editor.getByRole("combobox", { name: "Profile scope" }).selectOption("squad");
    await squadInput.fill("-2");
    await editor.getByRole("combobox", { name: "Profile scope" }).selectOption("hero");
    const heroChoice = editor.getByRole("combobox", { name: "Hero", exact: true });
    const heroSlot = await heroChoice.inputValue();
    const heroLabel = (await heroChoice.locator("option:checked").textContent())!.trim();
    const heroInput = editor.getByRole("textbox", { name: `Hero ${heroLabel} targeting`, exact: true });
    await expect(heroInput).toBeEnabled({ timeout: 30_000 });
    await heroInput.fill("3");
    await editor.getByRole("button", { name: "Review preferences", exact: true }).click();
    review = editor.getByRole("region", { name: "Review trial preferences" });
    await expect(review).toContainText("Army · navigation: Inherit → 0");
    await expect(review).toContainText(`Squad ${squad} · navigation: Inherit → -2`);
    await expect(review).toContainText(`Hero ${heroLabel} · targeting: Inherit → 3`);
    await review.getByRole("button", { name: "Apply trial preferences", exact: true }).click();
    await expect(editor).toContainText("Trial preferences applied.");

    const recoveryKey = "senkei.next-owned-workspace-recovery.v1";
    await expect.poll(async () => page.evaluate(key => {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      return saved?.trial_behavior_inputs?.army?.attacker?.navigation;
    }, recoveryKey)).toBe(0);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null"), recoveryKey);
    expect(saved.trial_behavior_inputs.army.attacker.engagement).toBeNull();
    expect(Object.values(saved.trial_behavior_inputs.squads.attacker)).toContainEqual(expect.objectContaining({ navigation: -2 }));
    expect(Object.values(saved.trial_behavior_inputs.heroes.attacker)).toContainEqual(expect.objectContaining({ targeting: 3 }));
    expect(saved.trial_behavior_inputs.army.defender).toBeUndefined();

    await page.reload();
    await openOwnedTrial(page);
    await page.locator("#next-tab-jinrei").click();
    editor = await openProfile(page);
    await editor.getByRole("combobox", { name: "Profile scope" }).selectOption("army");
    await expect(editor.getByRole("textbox", { name: "Army navigation", exact: true })).toHaveValue("0");
    await expect(editor.getByRole("textbox", { name: "Army engagement", exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "準備確認へ", exact: true }).click();
    await checkReady(page);
    await editJinreiFromReady(page, width);
    editor = await openProfile(page);
    await editor.getByRole("combobox", { name: "Profile scope" }).selectOption("hero");
    await editor.getByRole("combobox", { name: "Hero", exact: true }).selectOption(heroSlot);
    await expect(editor.getByRole("textbox", { name: `Hero ${heroLabel} targeting`, exact: true })).toHaveValue("3");
    await page.getByRole("button", { name: "準備確認へ", exact: true }).click();
    await expect(page.getByRole("button", { name: "戦闘開始", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "戦闘開始", exact: true }).click();
    await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
    await page.locator("#next-tab-jinrei").click();
    await page.getByRole("tab", { name: /Behavior Coverage/ }).click();
    const trial = page.getByRole("region", { name: "Trial Behavior at selected Tick" });
    await expect(trial).toBeVisible();
    const detail = trial.locator("details").filter({ has: page.getByText(/^Trial Behavior values/) }).first();
    await expect(detail).toBeVisible({ timeout: 30_000 });
    await detail.locator("summary").click();
    const navigation = detail.getByRole("row", { name: /navigation/ });
    await expect(navigation).toContainText("-2");
    await expect(navigation).toContainText("unchanged");
    await expect(trial).toContainText("Observation content was not retained");
  });
}
