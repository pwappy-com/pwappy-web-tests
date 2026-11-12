/** Read-only projection. Never return DOM, IDs, text, classes, URLs or coordinates. */
export function readSiblingDragSnapshot(container: any, point: { x: number; y: number }) {
    const empty = { captured: false, targetExists: false, targetInScrollport: false,
        pointerInScrollport: false, dragImageActive: false, dragActive: false,
        sourceMatched: false, siblingMarkerSelected: false, scrollAtBottom: false, scrollAtTop: false,
        canScroll: false, targetBelow: false, pointerInViewport: false, popupOpen: false, hit: 'outside' };
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
        pointerInScrollport,
        scrollAtBottom: !!tree && tree.scrollTop + tree.clientHeight >= tree.scrollHeight - 1,
        scrollAtTop: !!tree && tree.scrollTop <= 1,
        canScroll: !!tree && tree.scrollHeight > tree.clientHeight + 1,
        targetBelow: !!targetRect && !!rect && targetRect.bottom + 5 >= rect.bottom,
        pointerInViewport: point.x > 0 && point.y > 0 && point.x < win.innerWidth && point.y < win.innerHeight,
        popupOpen: container.showTemplatePopup === true,
        dragImageActive: !!doc.querySelector('.custom-drag-image'),
        dragActive: win.dragItemType === 'node-id',
        sourceMatched: !!source && win.dragItemType === 'node-id' && win.dragItemId === source.dataset.nodeId,
        siblingMarkerSelected: !!marker?.classList.contains('node-add-point')
            && !!marker.classList.contains('node-add-point-selected'), hit
    };
}

/** Read-only hit testing: select an unobstructed native auto-scroll edge. */
export function findNativeScrollEdge(container: any, input: { sourceX: number; sourceY: number; down: boolean }) {
    const root = container?.shadowRoot;
    const tree = root?.querySelector('#dom-tree');
    const win = container?.ownerDocument?.defaultView;
    if (!tree || !win) return null;
    const rect = tree.getBoundingClientRect();
    const xs = [rect.left + 10, rect.right - 10, rect.left + rect.width / 2];
    const candidates: {x:number;y:number;distance:number}[] = [];
    for (const inset of [5, 10, 15, 22, 28]) {
        const y = input.down ? rect.bottom - inset : rect.top + inset;
        for (const x of xs) {
            if (x <= 0 || y <= 0 || x >= win.innerWidth || y >= win.innerHeight) continue;
            const hit = root.elementFromPoint(x, y);
            if (!hit || !(hit === tree || tree.contains(hit))) continue;
            const distance = Math.max(Math.abs(x - input.sourceX), Math.abs(y - input.sourceY));
            if (distance > 10) candidates.push({x,y,distance});
        }
    }
    candidates.sort((a,b) => b.distance - a.distance);
    return candidates.length ? {x:candidates[0].x,y:candidates[0].y} : null;
}
