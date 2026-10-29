# 🌳 Climate Chaos Inc. — Heilbronn Edition

A small, silly 2D city simulator about keeping Heilbronn livable until 2050.
Plant trees, build (or resist) industry, and keep an eye on the smog and the thermometer.

**Play:** open `index.html` in a browser. There's no build step and no dependencies.

## The pitch

You are the new mayor of Heilbronn. The Neckar is warming up, the old coal plant at the harbor is still smoking, and **Herr Profitmeier** (a lobbyist with a monocle) keeps showing up with "deals". Your unpaid eco advisor, **Käthchen von Heilbronn**, offers advice and a fair amount of judgment.

## Core loop

1. **Earn**: industry, vineyards, solar, wind and taxes fill the treasury.
2. **Spend**: plant trees, build parks and tram stops, and bolt smoke filters onto factories.
3. **Survive**: every month the simulation updates smog, temperature, happiness and population.

## Mechanics

| System | How it works |
|---|---|
| **Smog** (0–100) | A city-wide pollution stock. It rises with net emissions and decays slowly. Trees filter in proportion to how dirty the air is, so getting to *zero* is hard. |
| **Local fields** | Every tile has its own smog and heat values. Chimneys blow smog **downwind** (the wind changes monthly and usually comes from the west), and trees clean and cool within 2 tiles. Toggle the **Smog/Heat overlays** to see them. |
| **Warming** (°C) | Global creep (+0.05 °C per year, not your fault) + smog + the urban heat island from industry. Tree shade can cut up to 0.7 °C off the heat island, but it can't undo global warming. |
| **Tree growth & stress** | Saplings take months to mature, and their effect scales with growth. A tree takes damage when the local smog or heat goes over its tolerance. Dead trees leave stumps. |
| **Seasons** | Summer heat (plus random heat waves) stresses trees. Birches cause pollen misery in spring, ginkgos stink in autumn, and maples make people happy in autumn. |
| **Happiness** | Drops with smog and heat. Rises with parks, eco housing, landmarks and trees near homes. It drives population, and population drives taxes. |
| **Electricity** (MW) | Every building makes or uses power. The coal plant makes 60 MW, wind 12 (more in winter, almost none on calm days), solar 8 (strong in summer, weak in winter) and the riverbank hydro plant a steady 10. The AI campus uses 30 MW, factories 5–14, housing 1.5 per block, and each smoke filter 1. Shortfalls are imported from the regional grid at €3 per MW, which also adds a little smog. Surplus is sold at €1.2 per MW. Beyond the 40 MW import limit the city has a **blackout**: industry income drops, taxes fall and citizens get grumpy. Cold snaps and summer air conditioning push demand up. The power bar on the left of the build menu shows it all. |
| **CO₂ price** | Arrives in Jan 2030 at €6 per smog unit for industry and goes up every year. Smoke filters start to pay for themselves. |
| **Profitmeier's offers** | Every 10–16 months: free coal plants, SUV factories, parking lots in place of your trees… Take the money or keep your dignity. |

### Tree species

| Tree | Cost | Smog ↓ | Shade | Grows | Smog tol. | Heat tol. | Personality |
|---|---|---|---|---|---|---|---|
| Birch *(Birke)* | €30 | 0.15 | 0.35 | 6 mo | 50 | +3.0 | Cheap and fast, but the pollen makes everyone sneeze |
| Norway Maple *(Spitzahorn)* | €45 | 0.22 | 0.5 | 8 mo | 60 | +3.4 | Autumn colors make people happy |
| Linden *(Linde)* | €55 | 0.26 | 0.65 | 12 mo | 60 | +3.5 | Bees, honey events |
| Plane Tree *(Platane)* | €85 | 0.30 | 1.0 | 14 mo | 85 | +4.3 | Best shade, handles traffic |
| Oak *(Stieleiche)* | €120 | 0.50 | 0.9 | 24 mo | 55 | +3.9 | Slow, but the best smog-eater |
| Ginkgo | €100 | 0.24 | 0.5 | 16 mo | 110 | +5.5 | Almost indestructible, smells like cheese |
| Trollinger Vine *(Weinrebe)* | €60 | 0.08 | 0.2 | 10 mo | 45 | +4.6 | Earns money, +50% on the Wartberg, bonus next to a Winery |

### Industry

| Building | Cost | Income/mo | Smog | Heat | Power |
|---|---|---|---|---|---|
| Coal Plant | €2,500 | €95 | 3.0 | 5 | +60 MW |
| Car Factory | €1,600 | €62 | 1.6 | 2.5 | −14 MW |
| Screw Factory | €900 | €36 | 0.9 | 1.5 | −6 MW |
| Salt Mine | €700 | €22 | 0.3 | 0.3 | −5 MW |
| AI Campus | €3,000 | €115 | 0.4 | 4 | −30 MW |
| Winery | €500 | €8 + €5/vine | 0.1 | 0.2 | −2 MW |

The **Green** tab has BUGA Parks, Solar Fields, Wind Turbines, Hydro Plants (riverbank only) and Tram Stops (which halve housing smog within 3 tiles). The **Housing** tab has regular and eco housing.

## Winning & losing

- **Lose** if smog hits 100, warming reaches +4.5 °C, the treasury drops below −€2,500, or the population falls under 30k.
- **Win** by reaching 2051. You get a score and a rank, from *Baron of Smog* up to *Ökologischer Oberbürgermeister des Jahrhunderts*. After that you can keep playing in endless mode.

## Controls

- Click to build. **Hold and drag** to plant rows of trees, parks or solar fields.
- **Mouse wheel** or the `＋`/`−` buttons zoom in and out. To pan, drag with no tool selected, right-drag, or use `WASD`/arrow keys. `⤢` shows the whole map.
- The map fills the screen. Stats and map settings (speed, overlays, zoom) float along the top, and the build menu and messages float on the right. The `⟩` button hides the build menu. Hover a tile to see its details.
- `Space` pause · `1–9` pick an item from the current tab · `B` bulldozer · `O` cycle overlays · `Esc` or right-click to deselect.
- The game autosaves to `localStorage` every 6 months and when you close the page.

## Look

Hand-painted, Ghibli-inspired, and drawn entirely procedurally on a canvas with no image assets.

- **Heilbronn floats in the sky.** The rocky underside has hanging roots and vines and fades into a bank of clouds, and the Neckar pours off the island's edge as a waterfall.
- **The sky moves.** Soft cumulus clouds drift past, their shadows slide across the town, and warm sunlight comes from the top-left, with cool blue-green shadows.
- **Painterly ground.** Watercolor-style grass with wildflower meadows, cobblestone streets, stone arch bridges, reeds, lily pads and mossy river stones.
- **Storybook buildings.** Pastel and half-timbered houses with flower boxes, shutters and tiled roofs. There's a brick-chimney coal works, a windmill, a water mill, a glass-domed AI conservatory and a vintage tram.
- **Layered trees** that sway in the wind and change with the seasons: snowy branches in winter, oaks keeping their dry leaves, golden ginkgos and red maples in autumn.
- **Ambient particles:** spring petals, summer dandelion fluff, autumn leaves and winter snow.

The painted terrain is cached once per season, so panning and zooming stay smooth.

## Code layout

```
index.html        page shell
css/style.css     UI styling (light/dark)
js/data.js        catalog, events, offers, achievements, jokes
js/map.js         stylized Heilbronn map generator
js/sim.js         monthly simulation (fields, smog, temperature, economy)
js/render.js      isometric canvas renderer: terrain, trees, buildings, particles, camera
js/ui.js          DOM UI, input, modals
js/main.js        game loop, save/load, intro and game over
```

Balance knobs live in `CATALOG` (`js/data.js`) and in `tick()`, `targetTemp()` and `computeBudget()` (`js/sim.js`).
