/** Read-only projection. Never return DOM, IDs, text, classes, URLs or coordinates. */
export function readSiblingDragSnapshot(container: any, point: { x: number; y: number }) {
    const empty = { captured: false, targetExists: false, targetInScrollport: false,
        pointerInScrollport: false, dragImageActive: false, dragActive: false,
        sourceMatched: false, siblingMarkerSelected: false, hit: 'outside' };
    const root = container?.shadowRoot;
    const doc = container?.ownerDocument;
    const win = doc?.defaultView;
    if (!root || !doc || !win) return empty;
    const target = root.querySelector('.node[data-node-dom-id="ons-button1"]');
    const source = root.querySelector('.node[data-node-dom-id="ons-button2"]');
    const tree = root.querySelector('#dom-tree');
    const marker = target?.nextElementSibling;
    const rect = tree?.getBoundingClientRect();
    const targetRect = target?.getBoundingClientRect();
    const inside = (x: number, y: number) => !!rect && x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;
    const pointerInScrollport = inside(point.x, point.y);
    const hitElement = root.elementFromPoint(point.x, point.y);
    const node = hitElement?.closest('.node');
    let hit = 'other';
    if (!hitElement || hitElement === container || !root.contains(hitElement)) hit = 'outside';
    else if (hitElement.closest('.top-container, #item-window')) hit = 'toolbar';
    else if (node && node === source) hit = 'dragged-node';
    else if (node && node === target) hit = 'target-node';
    else if (target && node === target.parentElement && pointerInScrollport && targetRect
        && point.y > targetRect.bottom && point.y < targetRect.bottom + 20) hit = 'target-gap';
    return {
        captured: true, targetExists: !!target,
        targetInScrollport: !!targetRect && inside(targetRect.left + targetRect.width / 2, targetRect.bottom + 5),
        pointerInScrollport, dragImageActive: !!doc.querySelector('.custom-drag-image'),
        dragActive: win.dragItemType === 'node-id',
        sourceMatched: !!source && win.dragItemType === 'node-id' && win.dragItemId === source.dataset.nodeId,
        siblingMarkerSelected: !!marker?.classList.contains('node-add-point')
            && !!marker.classList.contains('node-add-point-selected'), hit
    };
}
