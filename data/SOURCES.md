# BunnyCheck — Data Sources

## brands.json

Brand certification data in `brands.json` is sourced from:

### PETA Beauty Without Bunnies
- **URL:** https://www.peta.org/living/personal-care-fashion/beauty-without-bunnies/
- **Search tool:** https://www.peta.org/living/personal-care-fashion/beauty-without-bunnies/search/
- PETA maintains two lists: "Does Not Test on Animals" and "Does Not Test on Animals & Does Not Contain Animal Ingredients." Both qualify for `"peta": true`.

### Leaping Bunny Program
- **URL:** https://www.leapingbunny.org/
- **Brand search:** https://www.leapingbunny.org/guide/brands
- Leaping Bunny is administered by the Coalition for Consumer Information on Cosmetics (CCIC) and requires third-party audits of the full supply chain. Only brands that have completed this audit qualify for `"leaping_bunny": true`.

## Verification dates

All entries were last verified on 2026-06-06. Certification statuses can change (brands may be acquired by parent companies that test in China, or may independently pursue new certifications). The `last_verified` field on each brand entry records when its status was last confirmed against the above sources.

## Updating data

To update the dataset, check both sources above for each brand and update the corresponding `peta`, `leaping_bunny`, and `last_verified` fields in `brands.json`. Bump `data_version` on any entry that changes.
