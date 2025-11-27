import type powerbi from "powerbi-visuals-api";
type ISelectionId = powerbi.visuals.ISelectionId;

/**
 * Original selection check function - calls getSelectionIds() internally
 * @deprecated Use identitySelectedWithCache for performance in bulk operations
 */
export default function identitySelected(identity: ISelectionId | ISelectionId[], selectionManager: powerbi.extensibility.ISelectionManager): boolean {
  const allSelectedIdentities = selectionManager.getSelectionIds() as ISelectionId[];
  var identity_selected = false;
  for (const selected of allSelectedIdentities) {
    if (Array.isArray(identity)) {
      for (const d of identity) {
        if (selected === d) {
          identity_selected = true;
          break;
        }
      }
    } else {
      if (selected === identity) {
        identity_selected = true;
        break;
      }
    }
  }
  return identity_selected;
}

/**
 * Session 9: Optimized selection check using pre-cached Set of selection IDs
 * Provides O(1) lookup vs O(n) iteration per check
 * 
 * @param identity - Single identity or array of identities to check
 * @param selectedIdsSet - Pre-cached Set of selected IDs for O(1) lookup
 * @returns true if any of the identities are selected
 */
export function identitySelectedWithCache(
  identity: ISelectionId | ISelectionId[],
  selectedIdsSet: Set<ISelectionId>
): boolean {
  if (selectedIdsSet.size === 0) {
    return false;
  }
  
  if (Array.isArray(identity)) {
    // For arrays, check if any identity is in the set
    for (const id of identity) {
      if (selectedIdsSet.has(id)) {
        return true;
      }
    }
    return false;
  } else {
    // Single identity - O(1) lookup
    return selectedIdsSet.has(identity);
  }
}

/**
 * Session 9: Create a Set of selection IDs from the selection manager
 * Call this once before bulk selection checks
 * 
 * @param selectionManager - Power BI selection manager
 * @returns Set of selected ISelectionIds for O(1) lookups
 */
export function createSelectionIdSet(selectionManager: powerbi.extensibility.ISelectionManager): Set<ISelectionId> {
  const allSelectedIdentities = selectionManager.getSelectionIds() as ISelectionId[];
  return new Set(allSelectedIdentities);
}
