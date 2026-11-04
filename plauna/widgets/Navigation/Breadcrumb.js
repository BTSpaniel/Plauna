// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Breadcrumb - Navigation hierarchy widget for Plauna
 * Provides breadcrumb navigation with customizable separators
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf } from '../shared/appearance.js';

let _breadcrumbSequence = 0;
let _separatorSequence = 0;

function _newBreadcrumbId() {
    return `breadcrumb-${Date.now()}-${++_breadcrumbSequence}`;
}

function _newSeparatorId(id) {
    return `${id}-separator-${Date.now()}-${++_separatorSequence}`;
}

export class Breadcrumb extends UINode {
    // Widget metadata
    static id = 'breadcrumb';
    static name = 'Breadcrumb';
    static category = 'navigation';
    static icon = '🔗';
    static description = 'Breadcrumb navigation';
    static tags = ['navigation', 'breadcrumb'];
    static emits = ['select'];
    static optionValues = { separator: ['default', 'arrow', 'slash', 'dot'], size: ['xs', 'sm', 'md', 'lg', 'xl'] };
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            items: [],
            separator: '/'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Breadcrumb(_newBreadcrumbId(), options);
        if (container && container instanceof HTMLElement) {
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    static stories() {
        return {
            'Default': { items: [{ label: 'Projects', href: '#' }, { label: 'Particle Realms', href: '#' }, { label: 'Scenes' }] },
            'With home': { items: [{ label: 'Home', href: '#', icon: '\u{1F3E0}' }, { label: 'Assets', href: '#' }, { label: 'Textures' }] }
        };
    }
    
    constructor(id = _newBreadcrumbId(), options = {}) {
        super(id, 'breadcrumb');
        
        // Breadcrumb-specific properties
        this.items = options.items || [];
        this.separator = options.separator || 'default'; // default, arrow, slash, dot, custom
        this.customSeparator = options.customSeparator || '>';
        this.homeIcon = options.homeIcon || '🏠';
        this.maxItems = options.maxItems || null; // null = no limit
        this.collapsible = options.collapsible !== false;
        this.size = options.size || 'md';
        
        // State management
        this.activeIndex = options.activeIndex || this.items.length - 1;
        this.overflowStart = 0;
        this.overflowEnd = this.items.length - 1;
        
        // Set accessibility: <nav aria-label="Breadcrumb"> around an ordered list
        this.tag = 'nav';
        this.ariaLabel = options.ariaLabel || 'Breadcrumb';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build breadcrumb structure
        this.buildBreadcrumb();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        
        this.setStyles({
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: tokens.css('spacing.xs'),
            fontSize: sizeStyles.fontSize,
            lineHeight: sizeStyles.lineHeight,
            color: tokens.css('colors.text.secondary'),
            listStyle: 'none',
            padding: '0',
            margin: '0',
            outline: 'none'
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                fontSize: tokens.css('fontSizes.xs'),
                lineHeight: tokens.css('lineHeights.tight')
            },
            sm: {
                fontSize: tokens.css('fontSizes.sm'),
                lineHeight: tokens.css('lineHeights.normal')
            },
            md: {
                fontSize: tokens.css('fontSizes.md'),
                lineHeight: tokens.css('lineHeights.normal')
            },
            lg: {
                fontSize: tokens.css('fontSizes.lg'),
                lineHeight: tokens.css('lineHeights.relaxed')
            },
            xl: {
                fontSize: tokens.css('fontSizes.xl'),
                lineHeight: tokens.css('lineHeights.relaxed')
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    setupEventHandlers() {
        // Keyboard navigation
        this.addEventListener('keydown', (event) => {
            switch (event.key) {
                case 'ArrowLeft':
                    event.preventDefault();
                    this.navigatePrevious();
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    this.navigateNext();
                    break;
                case 'Home':
                    event.preventDefault();
                    this.navigateFirst();
                    break;
                case 'End':
                    event.preventDefault();
                    this.navigateLast();
                    break;
            }
        });
    }
    
    buildBreadcrumb() {
        this.clearChildren();
        
        if (this.items.length === 0) return;
        
        // Calculate visible items
        const visibleItems = this.calculateVisibleItems();
        
        // Items live in an ordered list
        const list = new UINode(`${this.id}-list`, 'ol');
        list.setStyles({
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: tokens.css('spacing.xs'),
            listStyle: 'none',
            margin: '0',
            padding: '0'
        });

        // Render each item; the separator sits inside the item it follows
        visibleItems.forEach((item, index) => {
            const actualIndex = this.getActualIndex(index);
            const isLast = index === visibleItems.length - 1;

            const itemElement = this.createBreadcrumbItem(item, actualIndex, isLast);
            if (!isLast) {
                const separator = this.createSeparator();
                separator.ariaHidden = 'true';
                itemElement.appendChild(separator);
            }
            list.appendChild(itemElement);
        });
        this.appendChild(list);
    }
    
    calculateVisibleItems() {
        if (!this.collapsible || !this.maxItems || this.items.length <= this.maxItems) {
            return this.items;
        }
        
        const visibleItems = [];
        const maxVisible = this.maxItems;
        
        // Always include first item (usually home)
        visibleItems.push(this.items[0]);
        
        // Calculate how many items we can show in the middle
        const remainingSlots = maxVisible - 2; // Reserve slots for first and last items
        const middleStart = Math.max(1, this.activeIndex - Math.floor(remainingSlots / 2));
        const middleEnd = Math.min(this.items.length - 2, middleStart + remainingSlots - 1);
        
        // Add overflow indicator if needed
        if (middleStart > 1) {
            visibleItems.push({ label: '...', type: 'overflow', disabled: true });
        }
        
        // Add middle items
        for (let i = middleStart; i <= middleEnd; i++) {
            visibleItems.push(this.items[i]);
        }
        
        // Add overflow indicator if needed
        if (middleEnd < this.items.length - 2) {
            visibleItems.push({ label: '...', type: 'overflow', disabled: true });
        }
        
        // Always include last item
        if (this.items.length > 1) {
            visibleItems.push(this.items[this.items.length - 1]);
        }
        
        return visibleItems;
    }
    
    getActualIndex(visibleIndex) {
        const visibleItems = this.calculateVisibleItems();
        const item = visibleItems[visibleIndex];
        
        if (item.type === 'overflow') {
            return -1; // Special index for overflow items
        }
        
        return this.items.indexOf(item);
    }
    
    createBreadcrumbItem(item, index, isLast) {
        const itemElement = new UINode(`${this.id}-item-${index}`, 'li');
        itemElement.setStyles({ display: 'flex', alignItems: 'center', gap: tokens.css('spacing.xs') });

        // Determine if this is the active item
        const isActive = index === this.activeIndex;

        // Create link or span
        const content = item.href ?
            new UINode(`${itemElement.id}-link`, 'a') :
            new UINode(`${itemElement.id}-span`, 'span');

        if (item.href) {
            content.userData.href = item.href;
        }
        if (isActive) {
            content.ariaCurrent = 'page';
        }
        
        // Set content
        if (item.icon && index === 0) {
            // Home icon for first item
            const icon = new UINode(`${content.id}-icon`, 'span');
            icon.textContent = item.icon;
            icon.setStyles({
                marginRight: tokens.css('spacing.xs'),
                fontSize: '0.9em'
            });
            content.appendChild(icon);
        }
        
        const label = new UINode(`${content.id}-label`, 'span');
        label.textContent = item.label;
        content.appendChild(label);
        
        // Set styles based on state; the current item and hovered links take the primary tone
        const c = toneOf('primary');
        const itemStyles = {
            display: 'flex',
            alignItems: 'center',
            textDecoration: 'none',
            color: isActive ? tokens.css('colors.text.primary') : tokens.css('colors.text.secondary'),
            fontWeight: isActive ? tokens.css('fontWeights.semibold') : tokens.css('fontWeights.normal'),
            cursor: item.disabled ? 'not-allowed' : (item.href ? 'pointer' : 'default'),
            opacity: item.disabled ? '0.6' : '1',
            transition: 'all 150ms ease',
            outline: 'none',
            borderRadius: tokens.css('borderRadius.sm'),
            padding: `${tokens.css('spacing.xs')} ${tokens.css('spacing.sm')}`,
            border: isActive ? `1px solid ${c.subtleBorder}` : '1px solid transparent',
            backgroundColor: isActive ? c.soft : 'transparent'
        };
        
        content.setStyles(itemStyles);
        
        // Add hover effects for interactive items
        if (!item.disabled && item.href) {
            content.addEventListener('mouseenter', () => {
                if (!isActive) {
                    content.setStyle('color', c.text);
                    content.setStyle('backgroundColor', c.soft);
                }
            });
            
            content.addEventListener('mouseleave', () => {
                if (!isActive) {
                    content.setStyle('color', tokens.css('colors.text.secondary'));
                    content.setStyle('backgroundColor', 'transparent');
                }
            });
            
            content.addEventListener('focus', () => {
                if (!isActive) {
                    content.setStyle('color', c.text);
                    content.setStyle('backgroundColor', c.soft);
                    content.setStyle('border', `1px solid ${c.base}`);
                }
            });
            
            content.addEventListener('blur', () => {
                if (!isActive) {
                    content.setStyle('color', tokens.css('colors.text.secondary'));
                    content.setStyle('backgroundColor', 'transparent');
                    content.setStyle('border', '1px solid transparent');
                }
            });
            
            content.addEventListener('click', (event) => {
                if (item.onClick) {
                    event.preventDefault();
                    item.onClick(item, index);
                }
                
                // Emit select event
                this.dispatchEvent({
                    type: 'select',
                    bubbles: false,
                    detail: { item, index }
                });
            });
        }
        
        itemElement.appendChild(content);
        return itemElement;
    }
    
    createSeparator() {
        const separator = new UINode(_newSeparatorId(this.id), 'span');
        separator.role = 'presentation';
        separator.ariaHidden = 'true';
        
        const separatorContent = this.getSeparatorContent();
        separator.textContent = separatorContent;
        
        separator.setStyles({
            color: tokens.css('colors.text.disabled'),
            margin: `0 ${tokens.css('spacing.xs')}`,
            fontSize: '0.8em',
            userSelect: 'none',
            pointerEvents: 'none'
        });
        
        return separator;
    }
    
    getSeparatorContent() {
        switch (this.separator) {
            case 'arrow':
                return '›';
            case 'slash':
                return '/';
            case 'dot':
                return '•';
            case 'chevron':
                return '›';
            case 'double-chevron':
                return '»';
            case 'custom':
                return this.customSeparator;
            case 'default':
            default:
                return '›';
        }
    }
    
    setItems(items) {
        this.items = items;
        this.activeIndex = Math.min(this.activeIndex, items.length - 1);
        this.buildBreadcrumb();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setActiveIndex(index) {
        if (index >= 0 && index < this.items.length) {
            this.activeIndex = index;
            this.buildBreadcrumb();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSeparator(separator, customSeparator = null) {
        this.separator = separator;
        if (customSeparator) {
            this.customSeparator = customSeparator;
        }
        this.buildBreadcrumb();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setMaxItems(maxItems) {
        this.maxItems = maxItems;
        this.buildBreadcrumb();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setCollapsible(collapsible) {
        this.collapsible = collapsible;
        this.buildBreadcrumb();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setSize(size) {
        this.size = size;
        this.setupStyles();
        this.buildBreadcrumb();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    // Navigation methods
    navigateFirst() {
        this.setActiveIndex(0);
    }
    
    navigateLast() {
        this.setActiveIndex(this.items.length - 1);
    }
    
    navigateNext() {
        if (this.activeIndex < this.items.length - 1) {
            this.setActiveIndex(this.activeIndex + 1);
        }
    }
    
    navigatePrevious() {
        if (this.activeIndex > 0) {
            this.setActiveIndex(this.activeIndex - 1);
        }
    }
    
    // Static factory methods for common breadcrumb types
    static createFileBreadcrumb(id, filePath, options = {}) {
        const pathParts = filePath.split('/');
        const items = pathParts.map((part, index) => ({
            label: part || 'root',
            href: index === pathParts.length - 1 ? null : `#${pathParts.slice(0, index + 1).join('/')}`,
            icon: index === 0 ? '📁' : null
        }));
        
        return new Breadcrumb(id, {
            items,
            separator: 'slash',
            collapsible: true,
            maxItems: 4,
            ...options
        });
    }
    
    static createSiteBreadcrumb(id, pages, options = {}) {
        const items = pages.map((page, index) => ({
            label: page.title,
            href: page.href,
            icon: index === 0 ? '🏠' : null
        }));
        
        return new Breadcrumb(id, {
            items,
            separator: 'chevron',
            ...options
        });
    }
    
    static createCategoryBreadcrumb(id, categories, options = {}) {
        const items = categories.map((category, index) => ({
            label: category.name,
            href: category.href,
            icon: category.icon
        }));
        
        return new Breadcrumb(id, {
            items,
            separator: 'arrow',
            collapsible: true,
            maxItems: 3,
            ...options
        });
    }
}
