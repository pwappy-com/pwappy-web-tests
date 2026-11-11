// Read-only mapping of Monaco's resolved binding, not the runner's OS.
// Monaco 0.55.1 exposes these fields through ResolvedKeybinding.getChords().
// Unsupported/missing bindings fail closed; never try alternate keys until one works.
export type NativeMonacoChord = {
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    keyLabel: string | null;
};

export function nativeMonacoShortcut(chords: NativeMonacoChord[] | null, key: 'a' | 'z'): string {
    if (!Array.isArray(chords) || chords.length !== 1) {
        throw new Error('Expected exactly one resolved Monaco shortcut chord');
    }
    const chord = chords[0];
    if (!chord || typeof chord.ctrlKey !== 'boolean' || typeof chord.metaKey !== 'boolean' ||
        chord.ctrlKey === chord.metaKey || chord.shiftKey !== false || chord.altKey !== false ||
        typeof chord.keyLabel !== 'string' || chord.keyLabel.toLowerCase() !== key) {
        throw new Error(`Expected plain Control/Meta+${key} Monaco binding`);
    }
    return `${chord.metaKey ? 'Meta' : 'Control'}+${key}`;
}

// CI deliberately drops raw attachments. Emit only this fixed-schema diagnostic
// to stdout; never serialize the source binding object, UA, context or storage.
export function nativeMonacoShortcutDiagnostic(
    selectAll: NativeMonacoChord[] | null,
    undo: NativeMonacoChord[] | null,
    platform: { macintoshUA: unknown; iosUA: unknown; maxTouchPoints: unknown }
): string {
    const selectAllShortcut = nativeMonacoShortcut(selectAll, 'a');
    const undoShortcut = nativeMonacoShortcut(undo, 'z');
    const count = platform.maxTouchPoints;
    const validCount = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
    return '[monaco-native-shortcuts] ' + JSON.stringify({
        selectAll: { modifier: selectAllShortcut === 'Meta+a' ? 'Meta' : 'Control', key: 'A', shortcut: selectAllShortcut },
        undo: { modifier: undoShortcut === 'Meta+z' ? 'Meta' : 'Control', key: 'Z', shortcut: undoShortcut },
        macintoshUA: typeof platform.macintoshUA === 'boolean' ? platform.macintoshUA : null,
        iosUA: typeof platform.iosUA === 'boolean' ? platform.iosUA : null,
        maxTouchPoints: validCount ? Math.min(count, 32) : null,
        touchCountCapped: validCount && count > 32
    });
}
