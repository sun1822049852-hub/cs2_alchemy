const path = require('path');
const fs = require('fs');

const snapshotDir = path.join(process.cwd(), 'logs/processed_inventory');
const files = fs.readdirSync(snapshotDir)
  .filter(f => f.startsWith('inventory_processed_'))
  .sort()
  .reverse();

const snapshotPath = path.join(snapshotDir, files[0]);
console.log('Loading snapshot:', snapshotPath);

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
console.log('Snapshot loaded, items:', snapshot.item_count);

const {selectCraftAssistForRecipe} = require('./node_sidecar/src/services/craftAssistService');

const materials = [
  {
    collection_id: 'set_community_33',
    rarity: 2,
    stattrak: false,
    target_count: 10
  }
];

(async () => {
  const blockedIds = [];
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < 10; i++) {
    console.log(`\n=== Attempt ${i + 1}/10 ===`);
    try {
      const result = await selectCraftAssistForRecipe({
        rows: snapshot.items,
        candidateRows: snapshot.items,
        targetWear: 0.27,  // Changed from targetValue to targetWear
        wearApproachMode: 'below',  // Changed from approachMode
        materials,
        useComponentItems: false,
        includeCooling: false,
        wearOffsetPct: 5,
        blockedIds
      });
      
      if (result.ok) {
        console.log('✓ Success');
        console.log('  Overall:', result.overall);
        console.log('  Item count:', result.itemIds ? result.itemIds.length : 0);
        if (result.itemIds) {
          blockedIds.push(...result.itemIds);
        }
        successCount++;
      } else {
        console.log('✗ Failed:', result.message);
        failCount++;
      }
    } catch (err) {
      console.error('✗ Error:', err.message);
      failCount++;
    }
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);
})();
