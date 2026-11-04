// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * VisualTree - Manages the retained visual tree and dirty propagation.
 *
 * Visual tree management pattern:
 * - Manages UINode hierarchy with root node
 * - Dirty flag management and propagation
 * - Update scheduling with requestAnimationFrame
 * - Performance tracking for update timing
 * - Callback hooks for layout, paint, accessibility updates
 * - Real geometry from a layout source: each node's layoutBox comes from
 *   Plauna's LayoutEngine run over the rendered tree (setLayoutSource)
 *
 * Features:
 * - setRoot(): Change root node (marks subtree dirty)
 * - markDirty(): Mark node as dirty (schedules update)
 * - markSubtreeDirty(): Mark entire subtree as dirty
 * - update(): Main update loop (processes dirty nodes)
 *
 * Update queues:
 * - layoutQueue: Nodes needing layout recalculation
 * - paintQueue: Nodes needing paint updates
 * - textQueue: Nodes needing text content updates
 * - accessibilityQueue: Nodes needing ARIA updates
 *
 * Architecture:
 * - root: Root UINode of the tree
 * - dirtyNodes: Set of all dirty nodes
 * - isUpdating: Flag to prevent re-entrant updates
 * - updateScheduled: Flag for RAF scheduling
 */
import { DIRTY } from './UINode.js';
import { PlaunaConsole } from '../console/PlaunaConsole.js';

export class VisualTree {
    constructor(rootNode) {
        this.root = rootNode || null;
        this.dirtyNodes = new Set();
        this.layoutQueue = [];
        this.paintQueue = [];
        this.textQueue = [];
        this.accessibilityQueue = [];
        this.isUpdating = false;
        this.updateScheduled = false;
        
        // Performance tracking
        this.frameCount = 0;
        this.lastFrameTime = 0;
        this.totalUpdateTime = 0;
        this.totalLayoutTime = 0;
        this.totalPaintTime = 0;
        
        // Update callbacks
        this.onLayoutUpdate = null;
        this.onPaintUpdate = null;
        this.onAccessibilityUpdate = null;

        // Layout source (setLayoutSource); a pending layout waits for a first render
        this.layoutSource = null;
        this.layoutPending = false;
        this.layoutDeferrals = 0;
        
        // Bind methods
        this.update = this.update.bind(this);
        this.scheduleUpdate = this.scheduleUpdate.bind(this);
    }

    setRoot(rootNode) {
        if (this.root) {
            // Clear old root
            this.markSubtreeDirty(this.root, DIRTY.ALL);
        }
        
        this.root = rootNode;
        if (this.root) {
            this.markSubtreeDirty(this.root, DIRTY.ALL);
        }
    }

    getRoot() {
        return this.root;
    }

    /**
     * Where the layout pass gets real geometry. `source.elementOf(node)` maps
     * a node to its rendered element; `source.layout(rootElement)` returns
     * Plauna's layout of it ({ boxes: Map<Element, box> } with scene
     * coordinates), or null while the tree is not rendered.
     */
    setLayoutSource(source) {
        this.layoutSource = source || null;
        if (this.layoutSource) this.requestLayout();
    }

    /** Lay the tree out again on the next update (rendered content changed). */
    requestLayout() {
        if (!this.layoutSource || !this.root) return;
        this.layoutPending = true;
        this.scheduleUpdate();
    }

    // Dirty flag management
    markDirty(node, flags) {
        node.markDirty(flags);
        this.dirtyNodes.add(node);
        
        // Schedule update if not already scheduled
        if (!this.updateScheduled) {
            this.scheduleUpdate();
        }
    }

    markSubtreeDirty(node, flags) {
        const stack = [node];
        
        while (stack.length > 0) {
            const current = stack.pop();
            current.markDirty(flags);
            this.dirtyNodes.add(current);
            
            // Add children to stack
            for (let i = current.children.length - 1; i >= 0; i--) {
                stack.push(current.children[i]);
            }
        }
    }

    clearDirty(node, flags) {
        node.clearDirty(flags);
        this.dirtyNodes.delete(node);
    }

    // Update scheduling
    scheduleUpdate() {
        if (this.updateScheduled) return;
        
        this.updateScheduled = true;
        
        // Use requestAnimationFrame for smooth updates
        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(this.update);
        } else {
            // Fallback for non-browser environments
            setTimeout(this.update, 16); // ~60fps
        }
    }

    // Main update loop
    update(timestamp = 0) {
        if (!this.isUpdating && (this.dirtyNodes.size > 0 || this.layoutPending)) {
            this.isUpdating = true;
            this.updateScheduled = false;
            
            const startTime = performance.now();
            const nodeCount = this.dirtyNodes.size;
            
            try {
                this.processDirtyNodes();
                this.updatePerformanceMetrics(timestamp);
            } finally {
                const updateTime = performance.now() - startTime;
                this.isUpdating = false;
                this.totalUpdateTime += updateTime;
                this.frameCount++;
                this.settleDirtyNodes();
                
                // Log performance metrics
                PlaunaConsole.performance('VisualTree.update', updateTime);
                PlaunaConsole.visualtree('updated', { 
                    dirtyNodes: nodeCount, 
                    frameCount: this.frameCount,
                    updateTime: updateTime.toFixed(2)
                });
            }
        }
    }

    processDirtyNodes() {
        // Process dirty nodes in order: style -> layout -> text -> paint -> accessibility
        this.processStyleDirty();
        this.processLayoutDirty();
        this.processTextDirty();
        this.processPaintDirty();
        this.processAccessibilityDirty();
    }

    /** Forget nodes the passes cleaned; retry a layout that waited for a render. */
    settleDirtyNodes() {
        const handled = DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.TEXT | DIRTY.PAINT | DIRTY.ACCESSIBILITY;
        for (const node of this.dirtyNodes) {
            if (!node.isDirty(handled)) this.dirtyNodes.delete(node);
        }
        if (this.layoutPending || this.dirtyNodes.size > 0) {
            this.scheduleUpdate();
        }
    }

    processStyleDirty() {
        for (const node of this.dirtyNodes) {
            if (node.isDirty(DIRTY.STYLE)) {
                this.updateNodeStyle(node);
                node.clearDirty(DIRTY.STYLE);
            }
        }
    }

    processLayoutDirty() {
        // Collect nodes that need layout
        this.layoutQueue = [];
        
        for (const node of this.dirtyNodes) {
            if (node.isDirty(DIRTY.LAYOUT)) {
                this.layoutQueue.push(node);
                node.clearDirty(DIRTY.LAYOUT);
            }
        }
        
        // Sort layout queue by depth (parents before children)
        this.layoutQueue.sort((a, b) => this.getNodeDepth(a) - this.getNodeDepth(b));
        
        // Process layout
        const layoutStartTime = performance.now();
        if (this.layoutSource) {
            if (this.layoutQueue.length) this.layoutPending = true;
            const rootElement = this.layoutPending && this.root ? this.layoutSource.elementOf(this.root) : null;
            const result = rootElement ? this.layoutSource.layout(rootElement) : null;
            if (result) {
                this.layoutPending = false;
                this.layoutDeferrals = 0;
                this.applyLayout(result);
            } else if (this.layoutPending && this.root && this.layoutDeferrals < 2) {
                // Not rendered yet (the paint pass renders it): try next frame
                this.layoutDeferrals++;
            } else {
                this.layoutPending = false;
                this.layoutDeferrals = 0;
            }
        } else {
            for (const node of this.layoutQueue) {
                this.updateNodeLayout(node);
            }
        }
        this.totalLayoutTime += performance.now() - layoutStartTime;
        
        if (this.onLayoutUpdate) {
            this.onLayoutUpdate(this.layoutQueue);
        }
        
        this.layoutQueue = [];
    }

    processTextDirty() {
        this.textQueue = [];
        
        for (const node of this.dirtyNodes) {
            if (node.isDirty(DIRTY.TEXT)) {
                this.textQueue.push(node);
                node.clearDirty(DIRTY.TEXT);
            }
        }
        
        for (const node of this.textQueue) {
            this.updateNodeText(node);
        }
        
        this.textQueue = [];
    }

    processPaintDirty() {
        this.paintQueue = [];
        
        for (const node of this.dirtyNodes) {
            if (node.isDirty(DIRTY.PAINT)) {
                this.paintQueue.push(node);
                node.clearDirty(DIRTY.PAINT);
            }
        }
        
        const paintStartTime = performance.now();
        for (const node of this.paintQueue) {
            this.updateNodePaint(node);
        }
        this.totalPaintTime += performance.now() - paintStartTime;
        
        if (this.onPaintUpdate) {
            this.onPaintUpdate(this.paintQueue);
        }
        
        this.paintQueue = [];
    }

    processAccessibilityDirty() {
        this.accessibilityQueue = [];
        
        for (const node of this.dirtyNodes) {
            if (node.isDirty(DIRTY.ACCESSIBILITY)) {
                this.accessibilityQueue.push(node);
                node.clearDirty(DIRTY.ACCESSIBILITY);
            }
        }
        
        for (const node of this.accessibilityQueue) {
            this.updateNodeAccessibility(node);
        }
        
        if (this.onAccessibilityUpdate) {
            this.onAccessibilityUpdate(this.accessibilityQueue);
        }
        
        this.accessibilityQueue = [];
    }

    // Per-node pass steps. Styles are computed by Plauna's StyleResolver
    // inside the layout source and written to elements by the renderer, so a
    // style change here only means the node's boxes may move.
    updateNodeStyle(node) {
        node.markDirty(DIRTY.LAYOUT);
    }

    /**
     * Without a layout source a node keeps the bounds its host set with
     * setLayoutBounds(); the pass only records that it ran.
     */
    updateNodeLayout(node) {
        node.lastLayoutTime = 0;
        node.layoutCount++;
    }

    /** Copy laid-out geometry into every rendered node's layoutBox. */
    applyLayout(result) {
        const boxes = result.boxes;
        this.traverse((node) => {
            const element = this.layoutSource.elementOf(node);
            const box = element ? boxes.get(element) : null;
            if (!box) return;
            node.setLayoutBounds(box.absX, box.absY, box.width, box.height);
            node.layoutCount++;
        });
    }

    // Text is laid out and drawn when the renderer syncs the node, which the
    // paint pass asks for
    updateNodeText(node) {
        node.markDirty(DIRTY.PAINT);
    }

    // The paint pass hands its nodes to onPaintUpdate (PlaunaApp: renderer
    // syncs); this counts them
    updateNodePaint(node) {
        node.paintCount++;
    }

    // ARIA state is written by the renderer, and the elements stay in the page
    // in every render mode, so the browser's accessibility tree follows them;
    // the pass hands its nodes to onAccessibilityUpdate
    updateNodeAccessibility() {}

    // Helper methods
    getNodeDepth(node) {
        let depth = 0;
        let current = node;
        while (current.parent) {
            depth++;
            current = current.parent;
        }
        return depth;
    }

    // Tree traversal methods
    traverse(callback, root = this.root) {
        if (!root) return;
        
        const stack = [root];
        
        while (stack.length > 0) {
            const node = stack.pop();
            callback(node);
            
            // Add children in reverse order to maintain traversal order
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push(node.children[i]);
            }
        }
    }

    traverseDepthFirst(callback, root = this.root) {
        if (!root) return;
        
        callback(root);
        for (const child of root.children) {
            this.traverseDepthFirst(callback, child);
        }
    }

    traverseBreadthFirst(callback, root = this.root) {
        if (!root) return;
        
        const queue = [root];
        
        while (queue.length > 0) {
            const node = queue.shift();
            callback(node);
            
            for (const child of node.children) {
                queue.push(child);
            }
        }
    }

    findNode(id, root = this.root) {
        if (!root) return null;
        
        if (root.id === id) return root;
        
        for (const child of root.children) {
            const result = this.findNode(id, child);
            if (result) return result;
        }
        
        return null;
    }

    findNodesByType(type, root = this.root) {
        const results = [];
        
        this.traverse(node => {
            if (node.type === type) {
                results.push(node);
            }
        }, root);
        
        return results;
    }

    findNodesByClass(className, root = this.root) {
        const results = [];
        
        this.traverse(node => {
            if (node.className.includes(className)) {
                results.push(node);
            }
        }, root);
        
        return results;
    }

    // Performance metrics
    updatePerformanceMetrics(timestamp) {
        if (this.lastFrameTime > 0) {
            const frameDelta = timestamp - this.lastFrameTime;
            // Could track frame rate, update times, etc.
        }
        this.lastFrameTime = timestamp;
    }

    // Validate the visual tree structure
    validate() {
        if (!this.root) {
            return false;
        }

        // Check for circular references
        const visited = new Set();
        const stack = [this.root];

        while (stack.length > 0) {
            const node = stack.pop();
            
            if (visited.has(node)) {
                return false; // Circular reference detected
            }
            
            visited.add(node);
            
            for (const child of node.children) {
                if (child.parent !== node) {
                    return false; // Invalid parent-child relationship
                }
                stack.push(child);
            }
        }

        return true;
    }

    getPerformanceStats() {
        return {
            frameCount: this.frameCount,
            totalUpdateTime: this.totalUpdateTime,
            totalLayoutTime: this.totalLayoutTime,
            totalPaintTime: this.totalPaintTime,
            averageUpdateTime: this.frameCount > 0 ? this.totalUpdateTime / this.frameCount : 0,
            averageLayoutTime: this.frameCount > 0 ? this.totalLayoutTime / this.frameCount : 0,
            averagePaintTime: this.frameCount > 0 ? this.totalPaintTime / this.frameCount : 0,
            dirtyNodesCount: this.dirtyNodes.size,
            layoutQueueLength: this.layoutQueue.length,
            paintQueueLength: this.paintQueue.length
        };
    }

    resetPerformanceStats() {
        this.frameCount = 0;
        this.totalUpdateTime = 0;
        this.totalLayoutTime = 0;
        this.totalPaintTime = 0;
        this.lastFrameTime = 0;
    }

    // Debug methods
    getTreeInfo(root = this.root, maxDepth = 10) {
        if (!root) return null;
        
        const info = {
            node: root.getDebugInfo(),
            children: []
        };
        
        if (maxDepth > 0) {
            for (const child of root.children) {
                info.children.push(this.getTreeInfo(child, maxDepth - 1));
            }
        }
        
        return info;
    }

    printTree(root = this.root, maxDepth = 5, indent = '') {
        if (!root) return;
        
        console.log(`${indent}${root.type}#${root.id} (dirty=${root.dirtyFlags})`);
        
        if (maxDepth > 0) {
            for (const child of root.children) {
                this.printTree(child, maxDepth - 1, indent + '  ');
            }
        }
    }

    // Validation
    validateTree(root = this.root) {
        if (!root) return true;
        
        const errors = [];
        const visited = new Set();
        
        this.traverseDepthFirst(node => {
            // Check for cycles
            if (visited.has(node)) {
                errors.push(`Cycle detected: node ${node.id} visited twice`);
                return;
            }
            visited.add(node);
            
            // Check parent-child consistency
            if (node.parent && !node.parent.children.includes(node)) {
                errors.push(`Parent-child inconsistency: ${node.id} not in parent's children`);
            }
            
            // Check sibling links
            if (node.nextSibling && node.nextSibling.previousSibling !== node) {
                errors.push(`Sibling link inconsistency: ${node.id}.nextSibling.previousSibling !== ${node.id}`);
            }
            
            if (node.previousSibling && node.previousSibling.nextSibling !== node) {
                errors.push(`Sibling link inconsistency: ${node.id}.previousSibling.nextSibling !== ${node.id}`);
            }
            
            // Check first/last child consistency
            if (node.children.length > 0) {
                if (node.firstChild !== node.children[0]) {
                    errors.push(`FirstChild inconsistency: ${node.id}.firstChild !== first child`);
                }
                if (node.lastChild !== node.children[node.children.length - 1]) {
                    errors.push(`LastChild inconsistency: ${node.id}.lastChild !== last child`);
                }
            } else {
                if (node.firstChild || node.lastChild) {
                    errors.push(`Child pointer inconsistency: ${node.id} has no children but has firstChild/lastChild`);
                }
            }
        });
        
        if (errors.length > 0) {
            console.error('Tree validation errors:', errors);
            return false;
        }
        
        return true;
    }

    // Cleanup
    destroy() {
        if (this.root) {
            this.root.destroy();
            this.root = null;
        }
        
        this.dirtyNodes.clear();
        this.layoutQueue = [];
        this.paintQueue = [];
        this.textQueue = [];
        this.accessibilityQueue = [];
        
        this.updateScheduled = false;
        this.isUpdating = false;
        
        this.onLayoutUpdate = null;
        this.onPaintUpdate = null;
        this.onAccessibilityUpdate = null;
    }
}
