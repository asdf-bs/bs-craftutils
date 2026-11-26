# BsCrafttools

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 19.2.27.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

To build for production and package the browser files as `dist/bs-crafttools.zip`, run `npm run package`. This command requires the `zip` utility.

For temporary local testing, extract the ZIP and open `index.html` directly in your browser. The packaged build uses hash navigation (for example, `index.html#/resources`) so both workspaces remain available from a `file:` URL; hosted builds keep normal `/alchemy` and `/resources` paths. The package conversion preserves the app script URL for resolving the finder worker, which still falls back to scheduled main-thread search when local-file worker loading is blocked. The packaged build is separate from the GitHub Pages build. Browser storage for a local file is separate from the deployed site and may vary by browser or file location.

## GitHub Pages

In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. Pushes to the default branch and manual workflow runs build and deploy the site. The workflow sets the appropriate base URL for project and user/organization Pages sites.

## Herb notebook and potion finder

Enter the known effects from your character's Alchemy table for each herb; effect powers are optional. Blank powers use the assumed random 0.50–1.00 range in 0.01 increments, and effect strength plus any Growth intoxication surcharge are displayed as ranges; recipe ranking uses the 0.75 midpoint. The random distribution is unclear, so ranges are not probability intervals. Recorded powers are fixed for the character and do not vary between brews. Herb tables and their quality values are saved in this browser separately from legacy recipe data; the herb-effects and experiment panels are collapsed by default and show their expanded/collapsed state. The notebook is one set of tables per browser, not a manager for multiple character profiles. Mark a herb table complete only after recording all four effects.

Select desired effects to automatically refresh candidate 1 kg mixtures that contain every selected effect. By default, results must share exactly the selected effect IDs; if no exact match is found, an option appears to include additional known shared effects. Each selected effect must reach at least 1% strength in the 1 L clean-water decoction (100%) or 1 L serving of conventional 100° distillate (up to 133⅓%), or the mixture does not count as containing it. This 1% threshold applies to selected effects, not extra effects: any additional known shared effect disqualifies an exact match even if its displayed magnitude is below 1%. Magnitudes below 1% in either product are treated as zero for selected-effect matching and ranking, but remain visible in result estimates. For each herb combination, the finder keeps only its best-balanced tested quantity distribution, using the ratio of the weakest to strongest average desired-effect magnitudes across both products. It returns every matching combination and displays them by balance, then average desired-effect strength; ties prefer lower midpoint intoxication, then use a stable ingredient key. The results heading reports how many sampled combinations matched.

The finder checks all subsets of herbs with recorded effects and tests equal portions plus four evenly spaced quantity distributions between equal portions and each one-herb-dominant distribution. It skips any subset that cannot contain every desired effect, reuses each mixture calculation across both products, and keeps only each subset's best sample before ranking all matches at the end of the search. Search is debounced and runs in a web worker when available; if workers cannot start (including local-file builds), it uses scheduled cancellable batches so the page remains responsive. All matching results are rendered, so a large number of matches may take longer to display and use more memory. Obsolete searches are discarded, and equipment or herb-quality edits update quality estimates without rerunning the potion search. The chosen ratio is the best among the tested samples, not a proven ideal: other quantities are not exhaustively optimized, so no result does not prove a recipe is impossible. When powers are unknown, midpoint estimates determine matching and ranking; a strength range may straddle the 1% cutoff. Incomplete tables can hide shared effects, alter mixture powers and toxicity, and add a Growth intoxication surcharge beyond the reported range; unknown herbs are excluded and called out. The displayed ranges are conditional on the entered effect lists and do not account for hidden effects that change the sharing penalty.

Use the separate herb-strength experiment tool by mixing 0.89 kg of one target herb with 0.01 kg of every other herb, then entering every resulting effect and its mixture power to one decimal place, matching the game's display. Confirm that the observed effect list is complete before saving and inferring a target-power range. Existing saved experiments retain their original precision and estimates until edited; edits use the game's one-decimal precision, so correct any older values with more decimal places before saving. The inference follows the sharing behavior modeled by the estimator and accounts for known co-herb powers plus possible contributions from incomplete or unrecorded tables; its range is conditional on the target herb carrying the effect. Applying an estimate explicitly adds the rounded midpoint to an unknown herb power, never overwriting a recorded numeric value. Experiment observations are stored separately from herb tables.

The optional quality section accepts Alchemy skill, table quality, mortar type and quality, pot/still quality, water quality, and per-herb quality. It estimates mixture, brew, and distillate quality plus a duration multiplier; these values do not change estimated strength or intoxication. Absolute effect durations are unavailable because base durations are not provided. These estimates are approximate, and exact in-game behavior may differ. Mushrooms, poisons, mixed brews, partial distillation cuts, stacking, and current intoxication are not simulated.

The recipe editor is no longer part of the interface. Existing recipe data remains in browser storage and is not modified by the notebook or finder.

## Resource discoveries and route planning

The separate **Resources** workspace records discovered nodes by resource type, integer axial q/r coordinates, and quality from 1 to 100 (new nodes default to 100). Flint is available alongside the other resource types. Common names are accepted alongside catalog names: Oak/Hardwood, Pine/Softwood, Bush/Bushes, Dirt/Soil, Herb/Herbs, Iron/Iron ore, Copper/Copper ore, Tin/Tin ore, Silver/Silver ore, Stone or Rock/Boulder, Granite/Granite outcrop, Marble/Marble outcrop, and Gold or Golden shoal/Golden shoals. Resource data is stored in this browser under its own versioned storage key. Quality bands are low (1–29, brown), average (30–59, neutral), mid (60–89, blue), high (90–99, yellow), and perfect (100, white with a subtle outline glow); colored bands use outline-only highlighting, with theme-appropriate colors for both light and dark themes.

Type and quality filters combine, and selection can be individual or applied to all currently visible nodes. Selected nodes can be exported as a versioned `res1.` import code or imported and merged from another player; malformed codes do not write data, and existing type/coordinate nodes are kept rather than overwritten.

Raw imports accept newline-separated rows in the form `resource name q r` with optional quality, CSV rows with resource, q, r, and optional quality columns (a header row is supported), or grouped quality/coordinate lists such as `Clay: 100 (-120,35), (-135,75); 99 (27,-73), (186,-271)`. The colon after the grouped resource name is optional, and each quality applies to every coordinate in its group; use semicolons between quality groups. Catalog names and common aliases are accepted regardless of letter case; omitted simple-row quality defaults to 100. Paste text or choose a `.csv`/`.txt` file. The entire input is validated before merging, so invalid rows do not partially import; duplicate or already-saved type/coordinate pairs are skipped.

Angular routes are available at `/alchemy` and `/resources`; `/` redirects to `/alchemy`. The hosting server must return the Angular app entry point for these deep links to support direct visits and refreshes. Static hosts such as GitHub Pages need an appropriate fallback or redirect configuration.

Route generation immediately offers an approximate open route through the selected nodes, then uses A* to search for the exact shortest route by total walking distance using axial hex distance `max(|dq|, |dr|, |dq + dr|)`. It precomputes the best walking or portal-assisted leg between the start and selected nodes, improves an initial nearest-neighbor route, and prioritizes partial routes using an admissible lower bound from the next leg plus a minimum spanning tree of the remaining targets. Exact optimization is exponential, so at most 20 targets are accepted and the search stops after roughly 3 seconds, 150,000 processed states, or 300,000 queued states, whichever comes first. The best route remains available if the search is cancelled or reaches a limit; it is labeled approximate unless optimality was proven. The route is not a time estimate: terrain, obstacles, race-dependent movement speed, gathering time, and return travel are not included. Portals are optional and their travel contributes no walking distance; each portal-assisted leg is shown as a separate numbered portal step followed by its resource stop. The portal step gives the walking distance and coordinates to reach the entrance, and the resource step gives the walking distance from the exit. All portal uses share a 20-minute cooldown; cooldown waits and arrival times are not modeled, so allow the cooldown time between portal uses as needed. When distances tie, the planner prefers fewer portal uses.

Crossways, Drywind, Manehold, Deepmere, and Rapids have confirmed portal addresses. Regional addresses are inferred from the supplied distances, assuming straight-line axial hex distance from the given town center:

| Region | Town center (q, r) | Portal (q, r) | Distance | Address |
| --- | --- | --- | --- | --- |
| Scorched March | Drywind (36, 96) | (26, 275) | 179 | `01-10-05-10-10-06-06` |
| Scorched March | Drywind (36, 96) | (54, 238) | 160 | `04-09-03-12-06-05-04` |
| Scorched March | Drywind (36, 96) | (91, 213) | 172 | `12-05-05-08-02-04-01` |
| Feathergrass Steppe | Manehold (-152, 44) | (-241, -9) | 142 | `01-08-08-06-06-11-01` |
| Feathergrass Steppe | Manehold (-152, 44) | (-256, 17) | 131 | `09-04-03-05-11-12-08` |
| Lakewilds | Deepmere (-32, -156) | (33, -269) | 113 | `03-05-05-09-07-04-09` |
| Lakewilds | Deepmere (-32, -156) | (13, -261) | 105 | `10-07-02-05-06-02-08` |
| Blackwood | Rapids (180, -152) | (293, -246) | 113 | `09-12-06-09-05-06-11` |
| Blackwood | Rapids (180, -152) | (289, -255) | 109 | `02-11-06-12-04-02-02` |
| Blackwood | Rapids (180, -152) | (294, -272) | 120 | `01-04-04-10-10-11-11` |

Feathergrass Steppe's portal at q -250, r 39 has no known address. Route steps show a copy button for the destination portal only, not its address. Copying uses the browser clipboard with a legacy fallback and reports success or failure.

## Running unit tests

With Node.js 22 and Chrome installed, run the [Karma](https://karma-runner.github.io) unit tests once in headless Chrome:

```bash
npm test
```

If Chrome is not detected, set `CHROME_BIN` to its executable. For interactive testing, run `npm test -- --watch --browsers=Chrome`.

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
