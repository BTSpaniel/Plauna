// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Workbench lab widget renderer: registry widget map, WidgetContainer and the shared renderer.
 * Split out of lab/workbench-lab.js.
 */

import { UINode } from '../../core/UINode.js';
import { VisualTree } from '../../core/VisualTree.js';
import { DOMRenderer } from '../../core/DOMRenderer.js';
import { createWidget, getWidget, getAllWidgets } from '../../widgets/index.js';

// Simple counter for unique IDs
let widgetIdCounter = 0;

// Widget mapping system using new modular registry
const widgetMap = new Map();

// Initialize widget map from modular system
function initializeWidgetMap() {
    const allWidgets = getAllWidgets();
    for (const widgetClass of allWidgets) {
        widgetMap.set(widgetClass.id, (id, options) => createWidget(widgetClass.id, null, options));
    }
}

// Initialize on load
initializeWidgetMap();

// Widget container class using Plauna's UINode system
class WidgetContainer extends UINode {
    constructor(widgetType, options = {}) {
        super(`widget-${widgetType}`, 'widget-container');
        this.widgetType = widgetType;
        this.widget = null;
        this.options = options;
        
        this.setupContainer();
        this.createWidget();
    }
    
    setupContainer() {
        // Set container styles
        this.setStyles({
            display: 'flex',
            flexDirection: 'column',
            gap: 'spacing.md',
            padding: 'spacing.lg',
            backgroundColor: 'color(background.primary)',
            borderRadius: 'radius.lg',
            border: `1px solid color(border.medium)`,
            minWidth: '300px',
            maxWidth: '500px'
        });
    }
    
    createWidget() {
        if (!widgetMap[this.widgetType]) {
            console.warn(`Unknown widget type: ${this.widgetType}`);
            return;
        }
        
        try {
            // Generate unique ID using simple counter
            const uniqueId = ++widgetIdCounter;
            const widgetId = `workbench-${this.widgetType}-${uniqueId}`;
            
            console.log(`Creating widget ${this.widgetType} with ID: ${widgetId}`);
            console.log(`Widget constructor available:`, typeof widgetMap[this.widgetType]);
            
            this.widget = widgetMap[this.widgetType](widgetId, this.options);
            
            console.log(`Widget created successfully:`, this.widget);
            
            // Set up widget event handlers
            this.setupWidgetEvents();
            
            // Add widget to container
            this.addChild(this.widget);
            
        } catch (error) {
            console.error(`Error creating widget ${this.widgetType}:`, error);
            console.error(`Error details:`, error.stack);
        }
    }
    
    setupWidgetEvents() {
        if (!this.widget) return;
        
        // Common event handlers for all widgets
        if (this.widget.onChange) {
            this.widget.onChange = (value) => {
                console.log(`${this.widgetType} changed:`, value);
                if (this.options.onChange) {
                    this.options.onChange(value);
                }
            };
        }
        
        if (this.widget.onClick) {
            this.widget.onClick = () => {
                console.log(`${this.widgetType} clicked`);
                if (this.options.onClick) {
                    this.options.onClick();
                }
            };
        }
    }
    
    getWidget() {
        return this.widget;
    }
}

// Workbench VisualTree and Renderer management
let workbenchVisualTree = null;
let workbenchRenderer = null;
let workbenchRendererOwner = null;

export function initializeWorkbenchRenderer(container, textService, owner = null) {
    if (workbenchRenderer) {
        if (!owner || owner === workbenchRendererOwner) return workbenchRenderer;
        destroyWorkbenchRenderer(workbenchRendererOwner);
    }
    
    workbenchVisualTree = new VisualTree();
    workbenchRenderer = new DOMRenderer({
        container: container,
        textService: textService,
        usePretext: true
    });
    workbenchRendererOwner = owner;
    
    return workbenchRenderer;
}

export function destroyWorkbenchRenderer(owner = null) {
    if (owner && workbenchRendererOwner && owner !== workbenchRendererOwner) return false;
    try { workbenchVisualTree?.destroy?.(); } catch (_) {}
    try { workbenchRenderer?.destroy?.(); } catch (_) {}
    workbenchVisualTree = null;
    workbenchRenderer = null;
    workbenchRendererOwner = null;
    return true;
}

function showWidgetInContainer(widgetType, container, options = {}) {
    console.log(`showWidgetInContainer called for: ${widgetType}`);
    
    if (!workbenchVisualTree || !workbenchRenderer) {
        console.error('Workbench renderer not initialized');
        console.log('workbenchVisualTree:', workbenchVisualTree);
        console.log('workbenchRenderer:', workbenchRenderer);
        return null;
    }
    
    // Clear previous content
    if (workbenchRenderer.container !== container) {
        workbenchRenderer.clear();
        workbenchRenderer.container = container;
    }
    container.innerHTML = '';
    
    console.log(`Creating WidgetContainer for ${widgetType} with options:`, options);
    
    // Create widget container
    const widgetContainer = new WidgetContainer(widgetType, options);
    
    console.log(`WidgetContainer created:`, widgetContainer);
    
    // Set root and render
    workbenchVisualTree.setRoot(widgetContainer);
    workbenchRenderer.render(workbenchVisualTree);
    
    console.log(`Widget rendered to container`);
    
    return widgetContainer.getWidget();
}
