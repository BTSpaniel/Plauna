// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Tabs - Tab navigation widget for Plauna
 * Provides tabbed interface with keyboard navigation and styling
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf } from '../shared/appearance.js';

// The active tab: tone text and a tone indicator line
const ACTIVE = toneOf('primary');

let _tabsSequence = 0;

function _newTabsId() {
    return `tabs-${Date.now()}-${++_tabsSequence}`;
}

export class Tabs extends UINode {
    // Widget metadata
    static id = 'tabs';
    static name = 'Tabs';
    static category = 'navigation';
    static icon = '🗂️';
    static description = 'Tabbed navigation';
    static tags = ['navigation', 'tabs'];
    static optionValues = { variant: ['default', 'pills', 'underline', 'card'], orientation: ['horizontal', 'vertical'], stretch: 'boolean' };
    static dependencies = [];

    static getDefaultOptions() {
        return {
            tabs: [],
            activeTab: 0,
            orientation: 'horizontal',
            variant: 'default'
        };
    }

    static create(container, options = {}) {
        const instance = new Tabs(_newTabsId(), options);
        if (container && container instanceof HTMLElement) {
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }

    static stories() {
        return {
            'Default': { tabs: [{ title: 'Scene', content: 'Objects, lights and cameras.' }, { title: 'Assets', content: 'Models, textures and audio.' }, { title: 'Build', content: 'Targets and release settings.' }] },
            'Second tab active': { activeTab: 1, tabs: [{ title: 'General', content: 'Name and description.' }, { title: 'Physics', content: 'Gravity and solver steps.' }] }
        };
    }
    
    constructor(id = _newTabsId(), options = {}) {
        super(id, 'tabs');
        
        // Tabs-specific properties
        this.tabs = [];
        this.activeTab = options.activeTab || 0;
        this.orientation = options.orientation || 'horizontal';
        this.variant = options.variant || 'default';
        this.stretch = options.stretch || false;
        this.disabled = options.disabled || false;
        
        // Structure: a tablist of tab buttons above (or beside) the tab panels
        this.setStyles({
            display: 'flex',
            flexDirection: this.orientation === 'horizontal' ? 'column' : 'row',
            backgroundColor: 'transparent',
            border: 'none',
            outline: 'none'
        });
        this._tabList = new UINode(`${id}-list`, 'div');
        this._tabList.role = 'tablist';
        this._tabList.ariaOrientation = this.orientation;
        this._tabList.setStyles({
            display: 'flex',
            flexDirection: this.orientation === 'horizontal' ? 'row' : 'column'
        });
        this._panelContainer = new UINode(`${id}-panels`, 'div');
        this._panelContainer.setStyles({ display: 'block', flex: '1', outline: 'none' });
        this.appendChild(this._tabList);
        this.appendChild(this._panelContainer);

        // Setup event handlers
        this.setupEventHandlers();

        // Add initial tabs if provided
        if (options.tabs) {
            const initial = this.activeTab;
            options.tabs.forEach((tab) => {
                this.addTab(tab.title, tab.content, tab.options);
            });
            this.activeTab = -1;
            this.setActiveTab(Math.min(Math.max(initial, 0), this.tabs.length - 1));
        }
    }

    // Add a tab
    addTab(title, content, options = {}) {
        const tabIndex = this.tabs.length;
        const tabId = `${this.id}-tab-${tabIndex}`;
        const panelId = `${this.id}-panel-${tabIndex}`;
        
        // Create tab button (a real <button>, so it is focusable and clickable)
        const tabButton = new UINode(tabId, 'button');
        tabButton.userData.type = 'button';
        tabButton.role = 'tab';
        tabButton.setState(NODE_STATE.FOCUSABLE, !this.disabled);
        tabButton.setState(NODE_STATE.DISABLED, this.disabled);
        tabButton.ariaSelected = String(tabIndex === this.activeTab);
        tabButton.ariaControls = panelId;
        tabButton.tabIndex = tabIndex === this.activeTab ? '0' : '-1';
        
        tabButton.setStyles({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: this.orientation === 'horizontal' ? 'spacing.sm spacing.md' : 'spacing.md',
            backgroundColor: tabIndex === this.activeTab ? 'color(background.primary)' : 'transparent',
            color: tabIndex === this.activeTab ? ACTIVE.text : 'color(text.secondary)',
            border: 'none',
            borderBottom: this.orientation === 'horizontal' && tabIndex === this.activeTab ?
                `2px solid ${ACTIVE.base}` : '2px solid transparent',
            borderRadius: this.orientation === 'horizontal' ? 'radius.sm radius.sm 0 0' : 'radius.sm',
            fontFamily: 'inherit',
            fontSize: 14,
            fontWeight: tabIndex === this.activeTab ? 'typography.fontWeight.medium' : 'typography.fontWeight.regular',
            cursor: this.disabled ? 'not-allowed' : 'pointer',
            userSelect: 'none',
            transition: 'all 150ms ease',
            outline: 'none',
            flex: this.stretch ? '1' : 'none'
        });
        
        // Add tab content
        if (title) {
            const titleNode = new UINode(`${tabId}-title`, 'tab-title');
            titleNode.textContent = title;
            titleNode.setStyles({
                display: 'block',
                fontSize: 'inherit',
                fontWeight: 'inherit',
                color: 'inherit'
            });
            tabButton.appendChild(titleNode);
        }
        
        // Create tab panel
        const tabPanel = new UINode(panelId, 'tab-panel');
        tabPanel.role = 'tabpanel';
        tabPanel.ariaLabelledBy = tabId;
        tabPanel.tabIndex = '0';
        tabPanel.hidden = tabIndex !== this.activeTab;
        tabPanel.setStyles({
            display: tabIndex === this.activeTab ? 'block' : 'none',
            padding: 'spacing.md',
            backgroundColor: 'color(background.primary)',
            color: 'color(text.primary)',
            border: `1px solid color(border.light)`,
            borderTop: 'none',
            borderRadius: this.orientation === 'horizontal' ? '0 0 radius.md radius.md' : 'radius.md',
            outline: 'none'
        });
        
        // Add content to panel
        if (typeof content === 'string') {
            tabPanel.textContent = content;
        } else if (content instanceof UINode) {
            tabPanel.appendChild(content);
        }
        
        // Add tab event handlers
        this.setupTabEventHandlers(tabButton, tabIndex);
        
        // Add to tabs array
        this.tabs.push({
            button: tabButton,
            panel: tabPanel,
            title,
            content,
            options: { ...options, index: tabIndex }
        });
        
        this._tabList.appendChild(tabButton);
        this._panelContainer.appendChild(tabPanel);

        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        return tabIndex;
    }

    // Remove a tab
    removeTab(index) {
        if (index < 0 || index >= this.tabs.length) return false;
        
        const tab = this.tabs[index];
        const wasActive = index === this.activeTab;
        
        // Remove from the tree
        tab.button.destroy();
        tab.panel.destroy();
        
        // Remove from array
        this.tabs.splice(index, 1);
        
        // Update indices
        this.tabs.forEach((tab, i) => {
            tab.button.id = `${this.id}-tab-${i}`;
            tab.button.ariaControls = `${this.id}-panel-${i}`;
            tab.panel.id = `${this.id}-panel-${i}`;
            tab.panel.ariaLabelledBy = `${this.id}-tab-${i}`;
            tab.options.index = i;
        });
        
        // Adjust active tab if necessary
        if (wasActive) {
            if (this.tabs.length > 0) {
                this.setActiveTab(Math.min(index, this.tabs.length - 1));
            } else {
                this.activeTab = -1;
            }
        } else if (index < this.activeTab) {
            this.activeTab--;
        }
        
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        return true;
    }

    // Set active tab
    setActiveTab(index) {
        if (index < 0 || index >= this.tabs.length) return false;
        
        if (this.activeTab === index) return true;
        
        const oldIndex = this.activeTab;
        this.activeTab = index;
        
        // Update old tab
        if (oldIndex >= 0 && oldIndex < this.tabs.length) {
            const oldTab = this.tabs[oldIndex];
            oldTab.button.ariaSelected = 'false';
            oldTab.button.tabIndex = '-1';
            oldTab.panel.hidden = true;
            
            // Update old tab styles
            oldTab.button.setStyles({
                backgroundColor: 'transparent',
                color: 'color(text.secondary)',
                borderBottom: '2px solid transparent',
                fontWeight: 'typography.fontWeight.regular'
            });
            
            oldTab.panel.setStyles({
                display: 'none'
            });
        }
        
        // Update new tab
        const newTab = this.tabs[index];
        newTab.button.ariaSelected = 'true';
        newTab.button.tabIndex = '0';
        newTab.panel.hidden = false;
        
        // Update new tab styles
        newTab.button.setStyles({
            backgroundColor: 'color(background.primary)',
            color: ACTIVE.text,
            borderBottom: `2px solid ${ACTIVE.base}`,
            fontWeight: 'typography.fontWeight.medium'
        });
        
        newTab.panel.setStyles({
            display: 'block'
        });
        
        // Keyboard users moving between tabs keep focus on the active tab
        const focusInside = typeof document !== 'undefined' && this.element?.contains(document.activeElement);
        if (focusInside) {
            this.flushRender?.();
            newTab.button.element?.focus();
        }

        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        
        // Emit tab change event
        this.emitTabChange(oldIndex, index);
        
        return true;
    }

    // Get active tab
    getActiveTab() {
        return this.activeTab;
    }

    // Get tab by index
    getTab(index) {
        return this.tabs[index] || null;
    }

    // Get all tabs
    getAllTabs() {
        return this.tabs.map(tab => ({
            title: tab.title,
            index: tab.options.index,
            isActive: tab.options.index === this.activeTab
        }));
    }

    // Set orientation
    setOrientation(orientation) {
        if (this.orientation !== orientation) {
            this.orientation = orientation;
            this.setStyle('flexDirection', orientation === 'horizontal' ? 'column' : 'row');
            this._tabList.setStyle('flexDirection', orientation === 'horizontal' ? 'row' : 'column');
            this._tabList.ariaOrientation = orientation;
            
            // Update tab button styles
            this.tabs.forEach(tab => {
                const isHorizontal = orientation === 'horizontal';
                tab.button.setStyles({
                    padding: isHorizontal ? 'spacing.sm spacing.md' : 'spacing.md',
                    borderBottom: isHorizontal && tab.options.index === this.activeTab ? 
                        `2px solid ${ACTIVE.base}` : '2px solid transparent',
                    borderRight: !isHorizontal && tab.options.index === this.activeTab ? 
                        `2px solid ${ACTIVE.base}` : '2px solid transparent',
                    borderRadius: isHorizontal ? 'radius.sm radius.sm 0 0' : 'radius.sm'
                });
                
                tab.panel.setStyles({
                    borderTop: isHorizontal ? 'none' : `1px solid color(text.tertiary)`,
                    borderLeft: !isHorizontal ? 'none' : `1px solid color(text.tertiary)`,
                    borderRadius: isHorizontal ? '0 0 radius.md radius.md' : 'radius.md'
                });
            });
            
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }

    // Set variant
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.applyVariant();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }

    // Apply variant styles
    applyVariant() {
        switch (this.variant) {
            case 'pills':
                this.tabs.forEach(tab => {
                    tab.button.setStyles({
                        borderRadius: 'radius.full',
                        border: `1px solid ${tab.options.index === this.activeTab ? ACTIVE.base : 'color(text.tertiary)'}`,
                        borderBottom: 'none',
                        margin: this.orientation === 'horizontal' ? '0 spacing.xs 0 0' : '0 0 spacing.xs 0'
                    });
                });
                break;
                
            case 'underline':
                this.tabs.forEach(tab => {
                    tab.button.setStyles({
                        backgroundColor: 'transparent',
                        border: 'none',
                        borderBottom: tab.options.index === this.activeTab ? 
                            `2px solid ${ACTIVE.base}` : '2px solid transparent',
                        borderRadius: 'radius.none'
                    });
                });
                break;
                
            case 'card':
                this.setStyles({
                    backgroundColor: 'color(background.secondary)',
                    borderRadius: 'radius.md',
                    padding: 'spacing.xs'
                });
                break;
                
            default:
                // Default variant already applied
                break;
        }
    }

    // Setup tab event handlers
    setupTabEventHandlers(tabButton) {
        const indexOf = () => this.tabs.findIndex((tab) => tab.button === tabButton);

        // Click handler
        tabButton.addEventListener('click', () => {
            if (!this.disabled) {
                this.setActiveTab(indexOf());
            }
        });

        // Keyboard navigation
        tabButton.addEventListener('keydown', (event) => {
            if (this.disabled) return;
            const index = indexOf();

            switch (event.key) {
                case 'ArrowLeft':
                case 'ArrowUp':
                    if (this.orientation === 'horizontal' && event.key === 'ArrowLeft' ||
                        this.orientation === 'vertical' && event.key === 'ArrowUp') {
                        event.preventDefault();
                        this.navigateTab(-1);
                    }
                    break;
                    
                case 'ArrowRight':
                case 'ArrowDown':
                    if (this.orientation === 'horizontal' && event.key === 'ArrowRight' ||
                        this.orientation === 'vertical' && event.key === 'ArrowDown') {
                        event.preventDefault();
                        this.navigateTab(1);
                    }
                    break;
                    
                case 'Home':
                    event.preventDefault();
                    this.setActiveTab(0);
                    break;
                    
                case 'End':
                    event.preventDefault();
                    this.setActiveTab(this.tabs.length - 1);
                    break;
                    
                case 'Enter':
                case ' ':
                    event.preventDefault();
                    this.setActiveTab(index);
                    break;
            }
        });
    }

    // Navigate tabs
    navigateTab(direction) {
        if (this.tabs.length === 0) return;
        
        let newIndex = this.activeTab + direction;
        
        // Wrap around
        if (newIndex < 0) {
            newIndex = this.tabs.length - 1;
        } else if (newIndex >= this.tabs.length) {
            newIndex = 0;
        }
        
        this.setActiveTab(newIndex);
    }

    // Setup event handlers
    setupEventHandlers() {
        // Tab buttons are real buttons; focus needs no forwarding
    }

    // Emit tab change event
    emitTabChange(oldIndex, newIndex) {
        const changeEvent = {
            type: 'tab-change',
            target: this,
            oldIndex,
            newIndex,
            oldTab: this.tabs[oldIndex] || null,
            newTab: this.tabs[newIndex] || null,
            defaultPrevented: false,
            preventDefault: () => { changeEvent.defaultPrevented = true; }
        };
        
        this.dispatchEvent(changeEvent);
        
        if (!changeEvent.defaultPrevented) {
            this.handleTabChange(oldIndex, newIndex);
        }
    }

    // Handle tab change: announce the change that went through
    handleTabChange(oldIndex, newIndex) {
        this.dispatchEvent({
            type: 'tab-changed',
            target: this,
            oldIndex,
            newIndex,
            oldTab: this.tabs[oldIndex] || null,
            newTab: this.tabs[newIndex] || null
        });
    }

    // Get tabs info
    getInfo() {
        return {
            ...this.getDebugInfo(),
            tabs: this.getAllTabs(),
            activeTab: this.activeTab,
            orientation: this.orientation,
            variant: this.variant,
            stretch: this.stretch,
            disabled: this.disabled
        };
    }

    // Override destroy to clean up tabs-specific resources
    destroy() {
        // Tab buttons and panels are destroyed with their containers
        this.tabs = [];
        this.activeTab = -1;
        
        // Call parent destroy
        super.destroy();
    }
}

// Tabs factory functions
export const TabsFactory = {
    // Create basic tabs
    create(id, options = {}) {
        return new Tabs(id, options);
    },
    
    // Create tabs with predefined tabs
    createWithTabs(id, tabs, options = {}) {
        return new Tabs(id, { tabs, ...options });
    },
    
    // Create vertical tabs
    createVertical(id, options = {}) {
        return new Tabs(id, { orientation: 'vertical', ...options });
    },
    
    // Create stretched tabs
    createStretched(id, options = {}) {
        return new Tabs(id, { stretch: true, ...options });
    },
    
    // Create pill tabs
    createPills(id, options = {}) {
        return new Tabs(id, { variant: 'pills', ...options });
    },
    
    // Create underline tabs
    createUnderline(id, options = {}) {
        return new Tabs(id, { variant: 'underline', ...options });
    },
    
    // Create card tabs
    createCard(id, options = {}) {
        return new Tabs(id, { variant: 'card', ...options });
    }
};
