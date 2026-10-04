function normalizeSortText(value) {
  return String(value || "").trim();
}

export function compareLocale(left, right) {
  return normalizeSortText(left).localeCompare(normalizeSortText(right), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function getTimeValue(value) {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

// Entries are { item, index }. Dated items come first, oldest first; undated
// ones and equal times keep their list order.
export function compareCreatedOrder(left, right) {
  const leftTime = getTimeValue(left.item.createdAt);
  const rightTime = getTimeValue(right.item.createdAt);

  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  if (leftTime !== null && rightTime === null) {
    return -1;
  }

  if (leftTime === null && rightTime !== null) {
    return 1;
  }

  return left.index - right.index;
}

// Sorts items with a comparator over { item, index } entries.
export function sortLibraryItems(items, compare) {
  return items
    .map((item, index) => ({ item, index }))
    .sort(compare)
    .map(({ item }) => item);
}
