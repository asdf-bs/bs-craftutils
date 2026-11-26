# Alchemy formulas

Developer notes translated from Russian. The translation attributes these formulas to game code at commit `a3a16951` (November 22, 2026), but the cited source is not included in this repository, so the formulas and translation have not been independently verified.

Notation: `kg` denotes mass, `L` denotes liquid volume, and percentages are expressed as fractions (`1 = 100%`). Brew strength, effect power, effect magnitude, toxicity, and intoxication are distinct quantities.

Effect names follow the Alchemy Journal: Growth (translated as Magnification or Increase), Shrink (Reduction or Decrease), Care (Treatment), Stamina (Endurance), Tough hide (Strong skin), Stretch (Extensibility or Stretchability), Light step (Easy step), and Focus (Concentration). Oak's Tanned is a separate effect, not one of the Journal's 12 herb effects. The translated terms “Increase” and “Decrease” may also describe an effect's direction rather than its name.

```
swamp → gather herbs → mortar → herb mixture ─┬─ eat
                                              └─ pot + water (+ mushrooms) → herbal decoction ─┬─ bottle → drink
                                                                                               └─ still → distillate → bottle
```

The translation cites these game-source files:

| What | File |
| :---- | :---- |
| Herbs, character table, generator | `src/BattleStallions.Shared/Game/Alchemy.cs` (`HerbRules`, `AlchemyRules`, `AlchemyBook`) |
| Table, mortar, mixture | `src/BattleStallions.Shared/Game/AlchemyTable.cs` (`AlchemyTableRules`, `MixRules`) |
| Herb decoction, mushrooms | `src/BattleStallions.Shared/Game/HerbBrew.cs` (`HerbBrewRules`, `HerbBrewState`) |
| Still | `src/BattleStallions.Shared/Game/Still.cs` (`StillRules`) |
| Doses, maximums, intoxication | `src/BattleStallions.Shared/Game/Potions.cs` (`PotionRules`, `IntoxicationRules`, `DispelRules`) |
| Craft quality | `src/BattleStallions.Shared/Game/Quality.cs` (`QualityRules.Crafted`) |
| Server | `src/BattleStallions.Server/World/GameWorld.{Alchemy,AlchemyTable,Pot,Still,Potions}.cs`, `PotionDose.cs`, `Item.cs` (`AddLiquid`) |

---

## 1. Stored values per unit of brew strength

An herbal decoction is stored as `HerbBrewState(Strength, Effects, Intoxication)`:

- `Strength` — brew strength, from 0 to `4/3`. A strength of 1 (100%) corresponds to 0.25 kg of mixture per liter.
- `Effects` — a list of `(effect, Power)` pairs, with stored power normally between 0 and 1. Stored power is separate from brew strength.
- `Intoxication` — intoxication normalized to one unit of brew strength.

The amount per liter is generally the stored per-strength value multiplied by brew strength. Dilution or concentration can therefore change `Strength` without directly changing stored effect power or intoxication. Dividing by strength converts an amount back to a per-unit-of-strength value.

---

## 2. Character-specific herb table

`AlchemyRules.Extend` generates a separate random herb-effect table for each character, stored in `Character.Alchemy`.

| Constant | Value | Meaning |
| :---- | :---- | :---- |
| `SlotsPerHerb` | 4 | Four distinct effects per herb. |
| `MinHerbsPerEffect` | 3 | Each effect appears on at least three herbs. |
| `MinPower`–`MaxPower` | 0.50–1.00, in 0.01 steps | Effect power for an herb. |
| `MaxShared` | 2 | A pair of herbs shares at most two effects. |
| `BinderChanceOneIn` | 3 | The translation says one poison ingredient is guaranteed; each additional one has a one-in-three chance of being a binder rather than an amplifier. The exact rule needs verification. |

The translated power-generation expression is reproduced below, but `random(0.50)` is ambiguous and does not clearly establish the distribution:

```
Power = 0.5 + random(0.50) / 50 × 0.5
```

Generator rules:

- An herb does not have both opposite effects (`Opposite`, `HasOpposites`).
- The generator reportedly tries up to 200 random herb sets and checks whether any shortage of up to three herbs can be covered by the remaining herbs (`Feasible`). If it cannot find a feasible set, it selects the most-needed effects.
- It reportedly generates all new herbs up to 40 times and chooses a set with fewer herb pairs sharing more than two effects.
- Existing entries reportedly remain unchanged when new herbs are added. `Repair` exchanges slots in pairs while preserving each effect's herb count; the exchanged slots become unknown again.

### Herb toxicity

```
Toxicity(herb) = 0.75 if the herb has Growth in this character's table
               = 0.50 otherwise
```

The translation attributes this to `HerbRules.ToxicityOf` and a Growth-potion balance change on November 21, 2026.

### Herb gathering

```
herb quality = clamp(min(soil quality, floor(SkillWithBuffer(Grass))), 1, 100)
```

Each find yields 0.1 kg; each six-second attempt has a one-in-two chance of success. All 12 herbs are equally likely.

---

## 3. Craft quality (general formula)

`QualityRules.Crafted(skill, tool, material)` is used for the mortar, pot, and still:

```
SkillWithBuffer(s) = s + 20 × max(0, 1 − s/95) // bonus is 20 at skill 0 and falls to 0 at 95
made = floor(average(SkillWithBuffer(s), tool, material))
made = min(made, floor(SkillWithBuffer(s))) // cannot exceed buffered skill
made = clamp(made, 1, 100)
```

### Table and mortar bonuses

These are added after the general formula and can raise quality above the skill limit:

```
Bonus(table) = clamp(floor((table quality − 50) / 10), 0, 5) // 60 → +1, 99 → +4, 100 → +5
MortarBonus = floor(MaxBonus(mortar type) × mortar quality / 100)
MaxBonus: stone = 0, granite = 5, marble = 10 // granite quality 60 → +3
```

---

## 4. Mortar: herb mixture

`MixRules.Grind(book, parts)` uses the mixing character's herb table.

Conditions: at least two distinct herbs, no more than 1 kg per batch (`MortarKg`), and an open Alchemist station.

```
M = Σ mass of all herbs
for each effect E:
    holders = herbs in the mixture whose table contains E
    if |holders| < 2: E is not revealed
    share(E) = Σ_{h ∈ holders}(mass(h) × Power(h, E)) / M // other herbs dilute the share
n = number of revealed effects
Power_mixture(E) = round(share(E) / √n, 3) // multiple effects reduce each power by √n
Toxicity_mixture = Σ_h(mass(h) × Toxicity(h)) / M // mass-weighted average
```

If no effect is revealed, mixing fails without consuming the herbs. A revealed effect is discovered for each contributing herb in `holders`. Mixtures stack only when their effect sets, powers, and toxicity match (`MixRules.Same`).

**Mixture quality:**

```
Q = min(100, Crafted(Alchemist, mortar quality, herb quality by mass) + Bonus(table) + MortarBonus)
```

The translation reports 20 seconds of Alchemist work experience (`GrindSeconds`) and no tool wear.

**Example.** Herbs A (`E = 0.8`) and B (`E = 0.9`), at 0.1 kg each, give `share(E) = 0.17 / 0.2 = 0.85`. Adding 0.1 kg of herb C without E dilutes this to `0.17 / 0.3 ≈ 0.567`. If two effects are revealed, divide each share by `√2`.

### Eating the mixture

The serving size is capped at 0.25 kg (`EatPortion`); define `fraction = min(1, serving mass / 0.25 kg)`.

```
magnitude(E) = 0.10 × Power_mixture(E) × fraction // EatMagnitude
intoxication = 120 × Toxicity_mixture × fraction + 70 × magnitude(Growth)
```

A full portion gives 60 intoxication for ordinary herbs or 90 for Growth herbs, plus any Growth surcharge. Dose duration depends on mixture quality (section 8).

---

## 5. Pot: herbal decoction

`HerbBrewRules`: only the Alchemist operating the open station may add the mixture. The translation identifies the operator's level as `CookLevel` and the operator as `Item.PutBy`.

| Constant | Value |
| :---- | :---- |
| `MixPerLiter` | 0.25 kg/L, corresponding to brew strength 1 |
| `Ceiling` | 0.6, the ordinary-decoction magnitude ceiling at strength 1 |
| `MaxStrength` | `4/3` (about 133%), the maximum brew strength |
| `BrewedShare` | `4/15`, the fraction of mixture intoxication retained after brewing |

```
Strength(mixture, liters) = mass of mixture / (liters × 0.25 kg/L)
Cap(S) = 0.6 × clamp(S, 1, 4/3) // 60% for decoction; 80% for distillate at 133% strength
Magnitude(Power, S) = clamp(0.6 × Power × S, 0, Cap(S))
Intoxication(toxicity) = 120 × toxicity × 4/15 // per liter at S = 1; ordinary herbs → 16
```

**Brewing in clean water:** `S = min(1, Strength(...))`. Mixture above 100% strength is lost.

**Brewing in an existing decoction** (`HerbBrewRules.Brew`):

```
added = Strength(mass of new mixture, liters)
S_new = min(max(1, S_had), S_had + added) // brewing does not raise strength above 1 or reduce a stronger brew
effects = intersection of the decoction's and mixture's effects
power and intoxication = weighted averages using S_had and added (Blend)
no shared effects → burda (effects disappear)
```

The translated game term `burda` and its exact behavior require source verification.

**Brew quality:**

```
Q = Crafted(Alchemist skill, pot quality, Stuff)
Stuff = (mixture quality × mixture mass + water quality × water mass) / (mixture mass + water mass)
// water mass = liters × 1 kg/L; water without quality uses 45
```

In an existing decoction, quality is averaged using `S_had` and `added` as weights. No table bonus is applied. The translation reports 80 seconds of experience per kilogram of mixture (`XpSecondsPerKg`), or 20 seconds per 0.25 kg. It gives the names “Weak herbal decoction” below 35% strength, “Strong” at or above 85%, and “Distillate” above 100%.

### Mushrooms and berries in the pot (`HerbBrewRules.Poison`)

The mushroom's effect is selected from the table of the character who adds it. Add mushrooms after the herbal mixture has been brewed.

```
dose = 0.1 kg/L × liters // PoisonDoseKg: one piece per liter
share = min(1, mass/dose)
excess = max(0, mass − dose)

Binder: Intox ← Intox × (1 − 0.2 × share) // discovered immediately
Amplifier E: if E is in the decoction: Power(E) ← round(Power(E) × (1 + 0.15 × share), 3) // discovered
             otherwise: excess = mass (intoxication only); the property is not discovered

extra per liter = 200 × excess / liters // 20 intoxication per 0.1 kg excess per liter
Intox ← Intox + extra / S // convert to per-unit-of-strength intoxication
```

An amplifier can raise stored `Power` above 1; effect magnitude remains capped by `Cap(S)`.

### Intoxication from drinking a decoction or distillate

```
fraction = min(1, liters drunk / 1 L) // a bottle holds 1 L
I_drink = (Intox × S + 70 × Magnitude(Power_Growth, S)) × fraction
```

The Growth surcharge (`PotionRules.GrowthSurcharge`, 70 per 100% magnitude) is not stored in the brew; it is calculated when drinking. The translation attributes both drinking and bottle previews to `PotionRules.VialIntoxication`.

---

## 6. Mixing liquids

`Item.AddLiquid`, `HerbBrewRules.Blend`, and `SurvivalRules.Mix`:

```
S = clamp((L1 × S1 + L2 × S2) / (L1 + L2), 0, 4/3) // water has S = 0
if both liquids are herbal decoctions:
    identical effect sets (SameSet) → average Power and Intox with weights L × S
    otherwise → liquid without effects
herbal decoction + water → effects remain; S decreases
herbal decoction + oak decoction or burda → burda
quality = volume-weighted average
```

Mixing averages the values rather than increasing them. The `L × S` weights apply to stored power and intoxication; the exact liquid types and behavior of `burda` need source verification.

---

## 7. Still

`StillRules`: the boiler holds 10 L and the receiver holds 3 L. The boiler accepts herbal decoction; do not add liquid directly to the receiver.

| Constant | Value |
| :---- | :---- |
| `VolumeShare` | 0.3 L of distillate per liter processed |
| `StrengthFactor` | 3.3 |
| `SteamCut` | 0.5 — half of the intoxication is retained in the distillate calculation |
| `LitersPerMinute` | 3 liters of decoction per minute |
| `FuelSecondsPerLiter` | 60 seconds of burn time per liter of decoction |
| `FuelKg` | 10 kg of fuel capacity |
| `XpSecondsPerLiter` | 30 seconds of experience per liter of distillate |

### 7.1 Conventional distillation (100°): `Distill`

```
S' = min(4/3, S × 3.3)
Intox_L' = Intox × S × 3.3 × 0.5 // intoxication per liter; concentration applies even after strength is capped
Intox' = Intox_L' / S' // stored per unit of strength
Effects' = same effects; Power is unchanged // increased strength raises magnitude
```

**Processing step** (`GameWorld.Distil`):

```
liters_step = min(3/60 × seconds, liters in the boiler, receiver free volume / 0.3)
receiver += liters_step × 0.3
fuel -= liters_step × 60 / BurnSeconds(fuel) // firewood 120 s/kg → 0.5 kg per liter; coal 180 s/kg; branches 30 s/kg
```

**Distillate quality** (each addition is averaged by volume in the receiver):

```
Q = min(100, Crafted(Alchemist skill, still quality, decoction quality) + Bonus(table)) // no mortar bonus
```

The translation reports experience of 30 seconds per liter of distillate when the run stops. The still does not wear out.

**Examples:** `StrengthFactor = 3.3` is the stated approximation; it is not exactly `1 / 0.3`.

| Source brew | Distillate strength | Magnitude (Power 1) | Intoxication per 1 L bottle |
| :---- | :---- | :---- | :---- |
| Decoction at 100%, `Intox = 16` | About 133% | 80% | 16 × 1 × 3.3 × 0.5 = **26.4** |
| Decoction at 30%, `Intox = 16` | 99% | 59.4% | 16 × 0.3 × 3.3 × 0.5 = **7.92** |
| Growth decoction at 100%, `Intox = 24` | About 133% | 80% | 24 × 1.65 = 39.6; 39.6 + 70 × 0.8 = **95.6** |

### 7.2 Temperature cuts and effect separation: `Cut`

The temperature scale runs from 40° to 100° in steps of 2° (`Snap` rounds down). An effect leaves with the steam if `Temperature(E) ≤ T`:

| Effect | ° | Effect | ° |
| :---- | :---- | :---- | :---- |
| Light step | 44 | Rage | 74 |
| Focus | 50 | Consciousness | 80 |
| Mana | 56 | Tough hide | 84 |
| Stamina | 62 | Protein | 88 |
| Care | 66 | Shrink | 94 |
| Stretch | 70 | Growth (and any new effect) | 100 |

- If all boiler effects leave at temperature `T`, use conventional distillation (section 7.1).
- If no effects leave, the run fails with a “turn up the heat” message.
- Otherwise, effects separate into those carried with the steam (“light”) and those retained in the boiler (“heavy”).

The translation gives the following intoxication allocation:

```
light, heavy = effects that leave and remain, respectively
n = |all effects|, k = |light effects|
// Growth has ToxicWeight 2; other effects have weight 1
w(X) = Σ_{E ∈ X}(Power(E) × ToxicWeight(E))
lightToxic = Intox × w(light) / (w(light) + w(heavy))
heavyToxic = Intox − lightToxic
```

The partial-run state equations below are preserved from the translation, with terminology clarified. They are **incomplete or ambiguous**: `remaining` is not defined, and `first` and the concentration factors cannot be confirmed without the game source.

```
start = liters in the boiler + already collected
removing = start − collected / 0.3 // amount not yet processed
step = min(liters_step, removing)
gained = step × 0.3 // added to the receiver and removed from the boiler
after = liters in the boiler − gained

// Steam: light effects, adjusted and regrouped
first = liters in the boiler / remaining
vapor = Distill(S, light with Power × first → Regroup(n → k), lightToxic × first)

// Boiler: heavy effects concentrate; light effects diminish
thick = liters in the boiler / after
thin = (remaining − step) / remaining × thick
heavy.Power ← min(1, Power × thick)
light.Power ← Power × thin
Intox ← heavyToxic × thick + lightToxic × thin
```

When the entire volume has been processed, or the light effects have become traces, the run is `spent`: no light effects remain in the boiler, the heavy effects are regrouped (`Regroup(n → n − k)`), and distillation stops. The translation reports that a full pass of 10 L yields 3 L of distillate with light effects and leaves 7 L in the boiler with heavy effects, concentrated by `1 / 0.7`.

**Regroup — removing the sharing penalty** (November 22, 2026):

```
Regroup(Power, n, m) = min(1, Power × √(n/m)) // when 0 < m < n; otherwise unchanged
```

In the mortar, each of the `n` effects is weakened by `√n`; regrouping reverses the corresponding sharing penalty when effects separate, up to the power cap of 1. For example, a share of 0.6 split between two effects gives about 0.424 each (34% magnitude at distillate strength `4/3`); separating one restores power 0.6 (48% magnitude).

**Traces** (`Clean`, `FaintMagnitude = 0.005`): during a partial run, an effect with `Magnitude < 0.5%` is removed from the boiler along with its weighted share of intoxication, followed by regrouping. If there are no effects left to separate, the run fails. Exact ordering and boundary behavior require source verification.

### 7.3 Learning temperature thresholds: `Observe`

A run below 100° that processes at least 0.1 L (`LearnLiters`) records whether each effect leaves with the steam:

```
if the effect leaves:  AtMost = min(AtMost, T)
if the effect remains: Above = max(Above, T)
known when: AtMost − Above ≤ 2
```

The initial bounds are `Above = 38` and `AtMost = 100`. This resembles a binary search: about five runs may identify a threshold, and one run can update several effects. A 100° run teaches nothing.

---

## 8. Drinking: doses, duration, and stacking

`GameWorld.DrinkPotion`: a whole 1 L bottle is consumed at once; the liquid enters the stomach with water.

```
fraction = min(1, liters drunk / 1 L)
magnitude = Magnitude(Power, S) × fraction // a separate dose for each effect
duration = BaseDuration(effect) × DurationFactor(quality)
DurationFactor(q) = 2 if q ≥ 100
                  = 0.5 + clamp(q, 1, 99) /100 otherwise // 1 → ×0.51, 50 → ×1, 99 → ×1.49
```

Old brews without quality use 45.

**Stacking doses of the same effect** (`PotionRules.Stacked`, calculated from active doses):

```
positive doses in descending order: m1 + m2 / 2 + m3 / 4 + ...
subtract the same weighted sum for inverted (negative) doses
```

The contribution of either sign is at most twice its strongest dose. For example, three positive doses of 0.8 contribute `0.8 + 0.4 + 0.2 = 1.4`.

### Maximums and resulting changes

```
Amount(E, total) = Max(E) × max(−1, total)
Boost(E, total) = 1 + Amount(E, total) // multiplier
DamageTaken = max(0, 1 − Amount(ToughHide))
SizeFactor = (1 + 0.5 × Growth) / (1 + 3 × Shrink)
```

| Effect | `Max` | Action | Baseline |
| :---- | :---- | :---- | :---- |
| Growth | 0.5 | Height factor `1 + 0.5m`; mass scales with the cube of the height factor. | 20 min |
| Shrink | 3 | Height factor `1 / (1 + 3m)`. | 20 min |
| Care | 0.3 | Adds `0.3m` percentage points of health per second (`TickPotions`). | 5 min |
| Stamina | 0.5 | Replenishment factor `1 + 0.5m`. | 30 min |
| Mana | 0.5 | Replenishment factor `1 + 0.5m`. | 30 min |
| Tough hide | 0.15 | Damage-taken factor `1 − 0.15m`. | 15 min |
| Rage | 0.15 | Damage-dealt factor `1 + 0.15m`. | 15 min |
| Consciousness | 0.3 | Adds `0.3m` to a reserve multiplier; the affected reserve is unclear in the translation. | 20 min |
| Stretch | 0.15 | Swallowing-threshold factor `1 + 0.15m`. | 15 min |
| Protein | 0.15 | Digested mass factor `1 + 0.15m`. | 60 min |
| Light step | 0.2 | Improves overland travel; the exact measure is unclear in the translation. | 30 min |
| Focus | 0.2 | Reduces the manufacturing bar or time; the exact measure is unclear in the translation. | 60 min |
| Tanned (oak) | 1 | Digestion factor `1 − m`; the behavior at 100% is unclear in the translation. | 30 min |

`m` is the stacked dose magnitude. For example, an 80% Growth dose gives a height factor of 1.4 (mass factor about 2.7); an 80% Rage dose gives +12% damage; an 80% Shrink dose gives a height factor of about 0.29.

While swallowed, active doses and their effects are paused, except that body size remains changed. Death removes doses and clears intoxication.

### Oak decoction (for completeness)

```
magnitude(Tanned) = S × fraction
intoxication = 5 × S × fraction
```

---

## 9. Intoxication

`IntoxicationRules` uses one shared scale from 0 to 100.

```
can consume when current intoxication + intake ≤ 100
decline per hour = 15 × FoodSpeedup
FoodSpeedup = 1 + (clamp(food multiplier) − 1) / 3 × Fullness(hunger)
```

At a fullness value of 1 and a food multiplier of 10, the stated formula gives a fourfold decline rate. On returning to play, intoxication decreases by 15 per hour of absence without the food bonus (`CatchUpIntoxication`). The translation also says the decline stops inside a “predator”; the intended game state is unclear and needs verification. The bounds of `clamp` and the definition of `Fullness` are not specified here.

Summary for a full portion or bottle (toxicity 0.50 for ordinary herbs and 0.75 for Growth herbs):

| Case | Ordinary herbs | Growth (Power 1) |
| :---- | :---- | :---- |
| Eat a portion of the mixture | 60 | 90 + 70 × 0.1 = 97 |
| Bottle of decoction at 100% strength | 16 | 24 + 70 × 0.6 = 66 |
| Bottle of distillate at 133% strength | 26.4 | 39.6 + 56 = 95.6 |

---

## 10. Removing potion effects (bosses)

`DispelRules`: the translation names “Beast Deer” and “King of Deer” and reports a cost of 15 mana, a one-minute cooldown, and no use against a defense. The boss names and details may be translation artifacts.

- Positive herbal doses are removed except Shrink; the separate oak effect Tanned is unchanged.
- The King converts Growth magnitude `m` to Shrink magnitude `m / 3` and inverts other doses. The translation's reference to the old maximum magnitude is ambiguous. Inverted Care does not lower health below 25%.

---

## 11. Worked example

Assume two ordinary, non-Growth herbs: 0.125 kg of Herb A (`Care = 0.9`, `Mana = 0.7`) and 0.125 kg of Herb B (`Care = 0.8`, `Mana = 0.6`). These values illustrate the formulas, not a fixed in-game recipe:

1. **Mix:** The mass-weighted shares are `Care = 0.85` and `Mana = 0.65`. With two effects, mixture powers are `Care = round(0.85 / √2, 3) = 0.601` and `Mana = round(0.65 / √2, 3) = 0.460`. Herb toxicity is 0.50.
2. **Brew in 1 L of water:** `S = 0.25 / (1 × 0.25) = 1`. Magnitudes are `Care = 0.6 × 0.601 ≈ 36.1%` and `Mana = 0.6 × 0.460 = 27.6%`. Stored intoxication is 16.
3. **Cut at 60°:** Mana (56°) leaves with the steam; Care (66°) remains. The reported allocation gives light intoxication `16 × 0.460 / (0.460 + 0.601) ≈ 6.94`. If conventional distillation is then applied to this 1 L steam fraction, the Mana power is approximately `0.460 × √2 = 0.6505`, and its magnitude at `S = 4/3` is about 52%. Using the stated `3.3` factor gives approximately `6.94 × 3.3 × 0.5 = 11.45` intoxication per liter of distillate. The original translation additionally estimates the remaining Care power as `0.601 × (1 / 0.7) × √2`, capped at 1, but the partial-run equations are ambiguous; this boiler result is not confirmed.
4. **Drink a 1 L bottle:** each dose has duration `base × (0.5 + q / 100)` for quality below 100; at quality 100, the factor is 2.

This example yields only 0.3 L of distillate, not enough to fill a 1 L bottle. The calculation illustrates the translated formulas; the temperature-cut outcome requires verification against the game source.

---

## Where to check

The translation cites `AlchemyTests` (generator), `AlchemyTableTests` (mixing and quality), `HerbBrewTests` (strength, magnitude, mushrooms, mixing), `StillTests` (distillation, temperatures, regrouping, traces), `PotionTests` and `PotionEffectTests` (doses, timing, maximums), and `GrowthPotionNerfTests` (height, intoxication, removal). These tests are not included in this repository and have not been independently checked.
