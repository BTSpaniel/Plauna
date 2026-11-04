// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Menu - Navigation menu widget for Plauna
 * Provides menu functionality with multiple variants and states
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf, variantStyles, TONES } from '../shared/appearance.js';

// Variant names that pick a tone; anything else is the plain menu
const MENU_TONES = new Set([...TONES, 'secondary', 'error']);

let _menuSequence = 0;

function _newMenuId() {
    return `menu-${Date.now()}-${++_menuSequence}`;
}

export class Menu extends UINode {
    // Widget metadata
    static id = 'menu';
    static name = 'Menu';
    static category = 'navigation';
    static icon = '☰';
    static description = 'Navigation menu';
    static tags = ['navigation', 'menu'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            items: [],
            variant: 'vertical',
            collapsible: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new Menu(_newMenuId(), options);
        if (container && container instanceof HTMLElement) {
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    static stories() {
        return {
            'Vertical': { items: [{ label: 'Scenes', icon: '\u{1F5BC}' }, { label: 'Assets', icon: '\u{1F4E6}', badge: '12' }, { label: 'Settings', icon: '\u2699' }] },
            'Horizontal': { orientation: 'horizontal', items: [{ label: 'File' }, { label: 'Edit' }, { label: 'View' }] }
        };
    }
    
    constructor(id = _newMenuId(), options = {}) {
        super(id, 'menu');
        // A composite widget: render a <div>, not the native <menu> element
        this.tag = 'div';
        
        // Menu-specific properties
        this.items = options.items || [];
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error, info
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.orientation = options.orientation || 'vertical'; // vertical, horizontal
        this.selectable = options.selectable || false;
        this.multiSelect = options.multiSelect || false;
        this.selectedItems = new Set(options.selectedItems || []);
        this.hoverable = options.hoverable !== false;
        this.bordered = options.bordered || false;
        this.showIcons = options.showIcons !== false;
        this.showBadges = options.showBadges || false;
        
        // State management
        this.openMenus = new Set();
        this.focusedIndex = -1;
        
        // Set accessibility
        this.role = 'menu';
        this.ariaOrientation = this.orientation;
        this.ariaMultiSelectable = this.multiSelect;
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build menu structure
        this.buildMenu();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        const layoutStyles = this.getLayoutStyles();
        
        this.setStyles({
            display: this.orientation === 'horizontal' ? 'flex' : 'block',
            flexDirection: this.orientation === 'horizontal' ? 'row' : 'column',
            gap: tokens.css('spacing.sm'),
            padding: this.getPadding(),
            backgroundColor: this.getBackgroundColor(),
            color: this.getTextColor(),
            border: this.bordered ? '1px solid ' + this.getBorderColor() : 'none',
            borderRadius: tokens.css('borderRadius.md'),
            fontSize: 'inherit',
            fontWeight: tokens.css('fontWeights.medium'),
            outline: 'none',
            position: 'relative',
            transition: 'all 150ms ease',
            ...sizeStyles,
            ...variantStyles,
            ...layoutStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                fontSize: tokens.css('fontSizes.xs'),
                padding: tokens.css('spacing.sm') + ' ' + tokens.css('spacing.md')
            },
            sm: {
                fontSize: tokens.css('fontSizes.sm'),
                padding: tokens.css('spacing.md') + ' ' + tokens.css('spacing.lg')
            },
            md: {
                fontSize: tokens.css('fontSizes.md'),
                padding: tokens.css('spacing.lg') + ' ' + tokens.css('spacing.xl')
            },
            lg: {
                fontSize: tokens.css('fontSizes.lg'),
                padding: tokens.css('spacing.xl') + ' ' + tokens.css('spacing.xxl')
            },
            xl: {
                fontSize: tokens.css('fontSizes.xl'),
                padding: tokens.css('spacing.xxl') + ' ' + tokens.css('spacing.xxxl')
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getPadding() {
        const sizes = {
            xs: tokens.css('spacing.sm') + ' ' + tokens.css('spacing.md'),
            sm: tokens.css('spacing.md') + ' ' + tokens.css('spacing.lg'),
            md: tokens.css('spacing.lg') + ' ' + tokens.css('spacing.xl'),
            lg: tokens.css('spacing.xl') + ' ' + tokens.css('spacing.xxl'),
            xl: tokens.css('spacing.xxl') + ' ' + tokens.css('spacing.xxxl')
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        return {
            backgroundColor: this.getBackgroundColor(),
            color: this.getTextColor(),
            borderColor: this.getBorderColor()
        };
    }

    /** The menu's tone (secondary is neutral, error is danger), or null for the plain menu. */
    toneColors() {
        return MENU_TONES.has(this.variant) ? toneOf(this.variant) : null;
    }
    
    getLayoutStyles() {
        const layouts = {
            vertical: {
                flexDirection: 'column'
            },
            horizontal: {
                flexDirection: 'row'
            }
        };
        return layouts[this.orientation] || layouts.vertical;
    }
    
    getBackgroundColor() {
        const c = this.toneColors();
        return c ? variantStyles('surface', c.name).backgroundColor : tokens.css('colors.background.primary');
    }
    
    getTextColor() {
        return this.toneColors()?.text ?? tokens.css('colors.text.primary');
    }
    
    getBorderColor() {
        return this.toneColors()?.subtleBorder ?? tokens.css('colors.border.medium');
    }
    
    getSelectedBackgroundColor() {
        return this.toneColors()?.softHover ?? tokens.css('colors.background.tertiary');
    }
    
    getSelectedTextColor() {
        return this.toneColors()?.text ?? tokens.css('colors.text.primary');
    }
    
    setupEventHandlers() {
        this.addEventListener('keydown', (e) => {
            this.handleKeyboardNavigation(e);
        });
    }
    
    handleKeyboardNavigation(e) {
        switch (e.key) {
            case 'ArrowUp':
            case 'ArrowDown':
            case 'ArrowLeft':
            case 'ArrowRight':
                e.preventDefault();
                this.navigateMenu(e.key);
                break;
            case 'Home':
                e.preventDefault();
                this.focusFirstItem();
                break;
            case 'End':
                e.preventDefault();
                this.focusLastItem();
                break;
            case ' ':
            case 'Enter':
                if (this.focusedIndex >= 0 && this.focusedIndex < this.items.length) {
                    e.preventDefault();
                    this.toggleItemSelection(this.focusedIndex, e.ctrlKey || e.metaKey);
                }
                break;
            case 'Escape':
                e.preventDefault();
                this.clearSelection();
                break;
        }
    }
    
    navigateMenu(key) {
        const isVertical = this.orientation === 'vertical';
        const isForward = key === 'ArrowDown' || (isVertical && key === 'ArrowRight') || (!isVertical && key === 'ArrowDown');
        const isBackward = key === 'ArrowUp' || (isVertical && key === 'ArrowLeft') || (!isVertical && key === 'ArrowLeft');
        
        if (isForward) {
            this.focusedIndex = (this.focusedIndex + 1) % this.items.length;
        } else if (isBackward) {
            this.focusedIndex = this.focusedIndex <= 0 ? this.items.length - 1 : this.focusedIndex - 1;
        }
        
        this.updateFocus();
    }
    
    focusFirstItem() {
        this.focusedIndex = 0;
        this.updateFocus();
    }
    
    focusLastItem() {
        this.focusedIndex = this.items.length - 1;
        this.updateFocus();
    }
    
    updateFocus() {
        const menuItems = [...(this.element?.querySelectorAll('[data-menu-item]') ?? [])];
        menuItems.forEach((item, index) => {
            if (index === this.focusedIndex) {
                item.setAttribute('tabindex', '0');
                item.focus();
            } else {
                item.setAttribute('tabindex', '-1');
            }
        });
    }
    
    buildMenu() {
        this.clearChildren();
        
        // Create menu container
        const menuContainer = document.createElement('div');
        menuContainer.style.cssText = (
            'display: ' + (this.orientation === 'horizontal' ? 'flex' : 'block') + ';' +
            'flex-direction: ' + (this.orientation === 'horizontal' ? 'row' : 'column') + ';' +
            'gap: ' + tokens.css('spacing.sm') + ';' +
            'width: 100%;'
        );
        
        // Create menu items
        this.items.forEach((item, index) => {
            const menuItem = this.createMenuItem(item, index);
            menuContainer.appendChild(menuItem);
        });
        
        this.appendElement(menuContainer);
    }
    
    createMenuItem(item, index) {
        const hasChildren = item.children && item.children.length > 0;
        const isSelected = this.selectedItems.has(index);
        
        const menuItem = document.createElement('div');
        menuItem.dataset.menuItem = index.toString();
        menuItem.setAttribute('role', 'menuitem');
        menuItem.setAttribute('aria-selected', isSelected.toString());
        menuItem.setAttribute('tabindex', this.focusedIndex === index ? '0' : '-1');
        menuItem.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.css('spacing.sm') + ';' +
            'padding: ' + tokens.css('spacing.md') + ' ' + tokens.css('spacing.lg') + ';' +
            'border-radius: ' + tokens.css('borderRadius.sm') + ';' +
            'cursor: ' + (this.selectable ? 'pointer' : 'default') + ';' +
            'transition: all 150ms ease;' +
            'background: ' + (isSelected ? this.getSelectedBackgroundColor() : 'transparent') + ';' +
            'color: ' + (isSelected ? this.getSelectedTextColor() : 'inherit') + ';' +
            'border: ' + (this.bordered ? '1px solid ' + this.getBorderColor() : 'none') + ';'
        );
        
        // Add hover effect
        if (this.hoverable || this.selectable) {
            menuItem.addEventListener('mouseenter', () => {
                if (!isSelected) {
                    menuItem.style.background = this.getSelectedBackgroundColor();
                }
            });
            
            menuItem.addEventListener('mouseleave', () => {
                if (!isSelected) {
                    menuItem.style.background = 'transparent';
                }
            });
        }
        
        // Add icon if enabled
        if (this.showIcons && item.icon) {
            const icon = document.createElement('span');
            icon.textContent = item.icon;
            icon.style.cssText = (
                'font-size: 16px;' +
                'color: ' + (isSelected ? this.getSelectedTextColor() : tokens.css('colors.text.secondary')) + ';' +
                'flex-shrink: 0;'
            );
            menuItem.appendChild(icon);
        }
        
        // Add label
        const label = document.createElement('span');
        label.textContent = item.label || '';
        label.style.cssText = (
            'flex: 1;' +
            'color: inherit;' +
            'font-weight: ' + tokens.css('fontWeights.medium') + ';'
        );
        menuItem.appendChild(label);
        
        // Add badge if enabled
        if (this.showBadges && item.badge) {
            const badge = document.createElement('span');
            badge.textContent = item.badge;
            badge.style.cssText = (
                'background: ' + (this.toneColors() ?? toneOf('primary')).base + ';' +
                'color: ' + (this.toneColors() ?? toneOf('primary')).on + ';' +
                'font-size: ' + tokens.css('fontSizes.xs') + ';' +
                'font-weight: ' + tokens.css('fontWeights.bold') + ';' +
                'padding: 2px 6px;' +
                'border-radius: ' + tokens.css('borderRadius.sm') + ';' +
                'margin-left: ' + tokens.css('spacing.sm') + ';' +
                'flex-shrink: 0;'
            );
            menuItem.appendChild(badge);
        }
        
        // Add submenu indicator if has children
        if (hasChildren) {
            const submenuIndicator = document.createElement('span');
            submenuIndicator.textContent = '▶';
            submenuIndicator.style.cssText = (
                'font-size: 10px;' +
                'color: ' + (isSelected ? this.getSelectedTextColor() : tokens.css('colors.text.secondary')) + ';' +
                'margin-left: ' + tokens.css('spacing.sm') + ';' +
                'flex-shrink: 0;' +
                'transition: transform 150ms ease;'
            );
            menuItem.appendChild(submenuIndicator);
            
            // Add click handler for submenu
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleSubmenu(index);
            });
        }
        
        // Add click handler for selectable menus
        if (this.selectable) {
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleItemSelection(index, e.ctrlKey || e.metaKey);
            });
        }
        
        return menuItem;
    }
    
    toggleItemSelection(index, multiSelect = false) {
        if (!this.selectable) return;
        
        if (this.multiSelect || multiSelect) {
            if (this.selectedItems.has(index)) {
                this.selectedItems.delete(index);
            } else {
                this.selectedItems.add(index);
            }
        } else {
            this.selectedItems.clear();
            this.selectedItems.add(index);
        }
        
        this.buildMenu();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'selectionChange',
            bubbles: true,
            detail: {
                selectedItem: index,
                selectedItems: Array.from(this.selectedItems),
                item: this.items[index],
                multiSelect: this.multiSelect
            }
        });
    }
    
    toggleSubmenu(index) {
        if (this.openMenus.has(index)) {
            this.openMenus.delete(index);
        } else {
            this.openMenus.add(index);
        }
        
        this.markDirty(DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'submenuToggle',
            bubbles: true,
            detail: {
                itemIndex: index,
                isOpen: this.openMenus.has(index),
                item: this.items[index]
            }
        });
    }
    
    // Public methods
    setItems(items) {
        this.items = items || [];
        this.selectedItems.clear();
        this.openMenus.clear();
        this.focusedIndex = -1;
        this.buildMenu();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    addItem(item) {
        this.items.push(item);
        this.buildMenu();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    removeItem(index) {
        if (index >= 0 && index < this.items.length) {
            this.items.splice(index, 1);
            this.selectedItems.delete(index);
            this.openMenus.delete(index);
            this.buildMenu();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildMenu();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildMenu();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setOrientation(orientation) {
        if (this.orientation !== orientation) {
            this.orientation = orientation;
            this.setupStyles();
            this.buildMenu();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSelectable(selectable) {
        if (this.selectable !== selectable) {
            this.selectable = selectable;
            this.clearSelection();
            this.buildMenu();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setMultiSelect(multiSelect) {
        if (this.multiSelect !== multiSelect) {
            this.multiSelect = multiSelect;
            if (!multiSelect) {
                // Convert multi-selection to single selection
                if (this.selectedItems.size > 0) {
                    const firstSelected = Array.from(this.selectedItems)[0];
                    this.selectedItems.clear();
                    this.selectedItems.add(firstSelected);
                }
            }
            this.buildMenu();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setHoverable(hoverable) {
        if (this.hoverable !== hoverable) {
            this.hoverable = hoverable;
            this.buildMenu();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setBordered(bordered) {
        if (this.bordered !== bordered) {
            this.bordered = bordered;
            this.setupStyles();
            this.buildMenu();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowIcons(showIcons) {
        if (this.showIcons !== showIcons) {
            this.showIcons = showIcons;
            this.buildMenu();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowBadges(showBadges) {
        if (this.showBadges !== showBadges) {
            this.showBadges = showBadges;
            this.buildMenu();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    clearSelection() {
        this.selectedItems.clear();
        this.buildMenu();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'selectionClear',
            bubbles: true,
            detail: {}
        });
    }
    
    selectItem(index) {
        this.selectedItems.clear();
        this.selectedItems.add(index);
        this.buildMenu();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'itemSelect',
            bubbles: true,
            detail: {
                selectedItem: index,
                item: this.items[index]
            }
        });
    }
    
    deselectItem(index) {
        this.selectedItems.delete(index);
        this.buildMenu();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'itemDeselect',
            bubbles: true,
            detail: {
                selectedItem: index,
                item: this.items[index]
            }
        });
    }
    
    selectAll() {
        this.items.forEach((_, index) => {
            this.selectedItems.add(index);
        });
        this.buildMenu();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'selectAll',
            bubbles: true,
            detail: {
                selectedItems: Array.from(this.selectedItems)
            }
        });
    }
    
    deselectAll() {
        this.clearSelection();
    }
    
    // Static factory methods
    static createMenu(id, options = {}) {
        return new Menu(id, options);
    }
    
    static createPrimaryMenu(id, options = {}) {
        return new Menu(id, { variant: 'primary', ...options });
    }
    
    static createSecondaryMenu(id, options = {}) {
        return new Menu(id, { variant: 'secondary', ...options });
    }
    
    static createSuccessMenu(id, options = {}) {
        return new Menu(id, { variant: 'success', ...options });
    }
    
    static createWarningMenu(id, options = {}) {
        return new Menu(id, { variant: 'warning', ...options });
    }
    
    static createErrorMenu(id, options = {}) {
        return new Menu(id, { variant: 'error', ...options });
    }
    
    static createInfoMenu(id, options = {}) {
        return new Menu(id, { variant: 'info', ...options });
    }
    
    static createSmallMenu(id, options = {}) {
        return new Menu(id, { size: 'sm', ...options });
    }
    
    static createLargeMenu(id, options = {}) {
        return new Menu(id, { size: 'lg', ...options });
    }
    
    static createXLargeMenu(id, options = {}) {
        return new Menu(id, { size: 'xl', ...options });
    }
    
    static createHorizontalMenu(id, options = {}) {
        return new Menu(id, { orientation: 'horizontal', ...options });
    }
    
    static createVerticalMenu(id, options = {}) {
        return new Menu(id, { orientation: 'vertical', ...options });
    }
    
    static createSelectableMenu(id, options = {}) {
        return new Menu(id, { selectable: true, ...options });
    }
    
    static createMultiSelectMenu(id, options = {}) {
        return new Menu(id, { selectable: true, multiSelect: true, ...options });
    }
    
    static createBorderedMenu(id, options = {}) {
        return new Menu(id, { bordered: true, ...options });
    }
    
    static createIconMenu(id, options = {}) {
        return new Menu(id, { showIcons: true, ...options });
    }
    
    static createBadgeMenu(id, options = {}) {
        return new Menu(id, { showBadges: true, ...options });
    }
    
    static createNavigationMenu(id, options = {}) {
        return new Menu(id, {
            orientation: 'horizontal',
            showIcons: true,
            selectable: false,
            ...options
        });
    }
    
    static createContextMenu(id, options = {}) {
        return new Menu(id, {
            variant: 'default',
            size: 'sm',
            bordered: true,
            ...options
        });
    }
    
    static createDropdownMenu(id, options = {}) {
        return new Menu(id, {
            orientation: 'vertical',
            size: 'md',
            bordered: true,
            ...options
        });
    }
    
    static createTabMenu(id, options = {}) {
        return new Menu(id, {
            orientation: 'horizontal',
            selectable: true,
            multiSelect: false,
            ...options
        });
    }
    
    static createSidebarMenu(id, options = {}) {
        return new Menu(id, {
            orientation: 'vertical',
            size: 'lg',
            showIcons: true,
            ...options
        });
    }
    
    static createToolbarMenu(id, options = {}) {
        return new Menu(id, {
            orientation: 'horizontal',
            size: 'sm',
            showIcons: true,
            bordered: true,
            ...options
        });
    }
    
    static createApplicationMenu(id, options = {}) {
        return new Menu(id, {
            variant: 'primary',
            orientation: 'horizontal',
            size: 'md',
            showIcons: true,
            ...options
        });
    }
}
