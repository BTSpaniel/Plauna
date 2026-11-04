// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Sidebar - Sidebar navigation widget for Plauna
 * Provides sidebar functionality with multiple variants and states
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf, mix, TONES } from '../shared/appearance.js';

// Variant names that pick a tone; anything else is the plain bar
const BAR_TONES = new Set([...TONES, 'secondary', 'error']);

let _sidebarSequence = 0;

function _newSidebarId() {
    return `sidebar-${Date.now()}-${++_sidebarSequence}`;
}

export class Sidebar extends UINode {
    // Widget metadata
    static id = 'sidebar';
    static name = 'Sidebar';
    static category = 'navigation';
    static icon = '◀';
    static description = 'Sidebar navigation';
    static tags = ['navigation', 'sidebar'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            items: [],
            collapsible: true,
            width: '280px'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Sidebar(_newSidebarId(), options);
        if (container && container instanceof HTMLElement) {
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    static stories() {
        return {
            'Default': {
                brand: { text: 'Particle Realms' },
                items: [{ label: 'Scenes', icon: '\u{1F5BC}', active: true }, { label: 'Assets', icon: '\u{1F4E6}', badge: '12' }, { label: 'Settings', icon: '\u2699' }],
                footer: 'v0.8.0'
            }
        };
    }
    
    constructor(id = _newSidebarId(), options = {}) {
        super(id, 'sidebar');
        
        // Sidebar-specific properties
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error, info
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.position = options.position || 'left'; // left, right
        this.collapsible = options.collapsible || false;
        this.overlay = options.overlay || false;
        this.items = options.items || [];
        this.footer = options.footer || null;
        this.brand = options.brand || null;
        this.showBrand = options.showBrand !== false;
        this.showFooter = options.showFooter || false;
        this.collapsed = options.collapsed || false;
        this.width = options.width || null;
        this.mini = options.mini || false;
        
        // State management
        this.isCollapsed = this.collapsed || this.mini;
        this.isOverlayOpen = false;
        
        // Set accessibility
        this.role = 'navigation';
        this.ariaLabel = options.ariaLabel || 'Sidebar navigation';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build sidebar structure
        this.buildSidebar();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        const positionStyles = this.getPositionStyles();
        
        this.setStyles({
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.css('spacing.sm'),
            padding: this.getPadding(),
            backgroundColor: this.getBackgroundColor(),
            color: this.getTextColor(),
            border: 'none',
            borderRight: this.position === 'left' ? '1px solid ' + this.getBorderColor() : 'none',
            borderLeft: this.position === 'right' ? '1px solid ' + this.getBorderColor() : 'none',
            fontSize: 'inherit',
            fontWeight: tokens.css('fontWeights.medium'),
            outline: 'none',
            position: 'relative',
            transition: 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)',
            overflow: 'hidden',
            ...sizeStyles,
            ...variantStyles,
            ...positionStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                fontSize: tokens.css('fontSizes.xs'),
                padding: tokens.css('spacing.sm') + ' ' + tokens.css('spacing.md'),
                width: this.width || '200px'
            },
            sm: {
                fontSize: tokens.css('fontSizes.sm'),
                padding: tokens.css('spacing.md') + ' ' + tokens.css('spacing.lg'),
                width: this.width || '240px'
            },
            md: {
                fontSize: tokens.css('fontSizes.md'),
                padding: tokens.css('spacing.lg') + ' ' + tokens.css('spacing.xl'),
                width: this.width || '280px'
            },
            lg: {
                fontSize: tokens.css('fontSizes.lg'),
                padding: tokens.css('spacing.xl') + ' ' + tokens.css('spacing.xxl'),
                width: this.width || '320px'
            },
            xl: {
                fontSize: tokens.css('fontSizes.xl'),
                padding: tokens.css('spacing.xxl') + ' ' + tokens.css('spacing.xxxl'),
                width: this.width || '360px'
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getPadding() {
        const sizes = {
            xs: tokens.css('spacing.sm') + ' ' + tokens.css('spacing.md'),
            sm: tokens.css('spacing.md') + ' ' + tokens.css('spacing.lg'),
            md: tokens.css('spacing.lg') + ' ' + tokens.css('spacing.xl'),
            lg: tokens.css('spacing.xxl') + ' ' + tokens.css('spacing.xxxl'),
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

    /** The sidebar's tone (secondary is neutral, error is danger), or null for the plain sidebar. */
    toneColors() {
        return BAR_TONES.has(this.variant) ? toneOf(this.variant) : null;
    }

    /** Text of items that are not active: secondary text, or the on-colour softened on a tone. */
    getMutedTextColor() {
        const c = this.toneColors();
        return c ? mix(c.on, 76) : tokens.css('colors.text.secondary');
    }

    /** A wash for hovered items, mixed from the text colour so it shows on any fill. */
    getHoverColor() {
        return mix(this.getTextColor(), 10);
    }
    
    getPositionStyles() {
        const positions = {
            left: {
                left: '0'
            },
            right: {
                right: '0'
            }
        };
        return positions[this.position] || positions.left;
    }
    
    getBackgroundColor() {
        return this.toneColors()?.base ?? tokens.css('colors.background.primary');
    }
    
    getTextColor() {
        return this.toneColors()?.on ?? tokens.css('colors.text.primary');
    }
    
    getBorderColor() {
        return this.toneColors()?.base ?? tokens.css('colors.border.medium');
    }
    
    setupEventHandlers() {
        this.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOverlayOpen) {
                this.closeOverlay();
            }
        });
    }
    
    buildSidebar() {
        this.clearChildren();
        
        // Create sidebar container
        const sidebarContainer = document.createElement('div');
        sidebarContainer.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.css('spacing.sm') + ';' +
            'height: 100%;' +
            'width: 100%;' +
            'overflow: hidden;'
        );
        
        // Create brand section
        if (this.showBrand && this.brand) {
            const brandSection = this.createBrandSection();
            sidebarContainer.appendChild(brandSection);
        }
        
        // Create navigation items
        if (this.items.length > 0) {
            const navItems = this.createNavItems();
            sidebarContainer.appendChild(navItems);
        }
        
        // Create footer section
        if (this.showFooter && this.footer) {
            const footerSection = this.createFooterSection();
            sidebarContainer.appendChild(footerSection);
        }
        
        // Create collapse toggle
        if (this.collapsible || this.mini) {
            const collapseToggle = this.createCollapseToggle();
            sidebarContainer.appendChild(collapseToggle);
        }
        
        this.appendElement(sidebarContainer);
    }
    
    createBrandSection() {
        const brandSection = document.createElement('div');
        brandSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.css('spacing.sm') + ';' +
            'padding: ' + tokens.css('spacing.md') + ';' +
            'border-bottom: 1px solid ' + this.getBorderColor() + ';' +
            'font-size: ' + tokens.css('fontSizes.lg') + ';' +
            'font-weight: ' + tokens.css('fontWeights.semibold') + ';' +
            'color: inherit;' +
            'text-decoration: none;' +
            'cursor: pointer;' +
            'transition: all 150ms ease;' +
            'flex-shrink: 0;'
        );
        
        // Add brand logo if present
        if (this.brand.logo) {
            const logo = document.createElement('img');
            logo.src = this.brand.logo.src;
            logo.alt = this.brand.logo.alt || this.brand.text;
            logo.style.cssText = (
                'height: 24px;' +
                'width: auto;' +
                'object-fit: contain;' +
                'flex-shrink: 0;'
            );
            brandSection.appendChild(logo);
        }
        
        // Add brand text
        if (this.brand.text && !this.isCollapsed) {
            const brandText = document.createElement('span');
            brandText.textContent = this.brand.text;
            brandText.style.cssText = (
                'color: inherit;' +
                'font-weight: inherit;' +
                'font-size: inherit;' +
                'white-space: nowrap;' +
                'overflow: hidden;' +
                'text-overflow: ellipsis;'
            );
            brandSection.appendChild(brandText);
        }
        
        // Add hover effect
        brandSection.addEventListener('mouseenter', () => {
            brandSection.style.background = this.getHoverColor();
        });
        
        brandSection.addEventListener('mouseleave', () => {
            brandSection.style.background = 'transparent';
        });
        
        brandSection.addEventListener('click', (e) => {
            e.stopPropagation();
            this.dispatchEvent({
                type: 'brandClick',
                bubbles: true,
                detail: {
                    brand: this.brand
                }
            });
        });
        
        return brandSection;
    }
    
    createNavItems() {
        const navItems = document.createElement('div');
        navItems.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.css('spacing.xs') + ';' +
            'flex: 1;' +
            'overflow-y: auto;' +
            'overflow-x: hidden;'
        );
        
        this.items.forEach((item, index) => {
            const navItem = document.createElement('div');
            navItem.setAttribute('role', 'button');
            navItem.setAttribute('aria-label', item.label);
            navItem.setAttribute('aria-current', item.active ? 'page' : 'false');
            navItem.style.cssText = (
                'display: flex;' +
                'align-items: center;' +
                'gap: ' + tokens.css('spacing.sm') + ';' +
                'padding: ' + tokens.css('spacing.md') + ' ' + tokens.css('spacing.lg') + ';' +
                'color: ' + (item.active ? this.getTextColor() : this.getMutedTextColor()) + ';' +
                'font-weight: ' + (item.active ? tokens.css('fontWeights.semibold') : tokens.css('fontWeights.medium')) + ';' +
                'border-radius: ' + tokens.css('borderRadius.sm') + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;' +
                'position: relative;' +
                'text-decoration: none;' +
                'white-space: nowrap;' +
                'overflow: hidden;' +
                'text-overflow: ellipsis;'
            );
            
            // Add active indicator
            if (item.active) {
                const indicator = document.createElement('div');
                indicator.style.cssText = (
                    'position: absolute;' +
                    (this.position === 'left' ? 'left: 0;' : 'right: 0;') +
                    'top: 0;' +
                    'bottom: 0;' +
                    'width: 3px;' +
                    'background: ' + this.getTextColor() + ';'
                );
                navItem.appendChild(indicator);
            }
            
            // Add icon if present
            if (item.icon) {
                const icon = document.createElement('span');
                icon.textContent = item.icon;
                icon.style.cssText = (
                    'font-size: 18px;' +
                    'color: inherit;' +
                    'flex-shrink: 0;' +
                    'width: 20px;' +
                    'text-align: center;'
                );
                navItem.appendChild(icon);
            }
            
            // Add label (only if not collapsed)
            if (!this.isCollapsed) {
                const label = document.createElement('span');
                label.textContent = item.label;
                label.style.cssText = (
                    'color: inherit;' +
                    'font-weight: inherit;' +
                    'font-size: inherit;' +
                    'flex: 1;' +
                    'overflow: hidden;' +
                    'text-overflow: ellipsis;'
                );
                navItem.appendChild(label);
            }
            
            // Add badge if present
            if (item.badge && !this.isCollapsed) {
                const badge = document.createElement('span');
                badge.textContent = item.badge;
                badge.style.cssText = (
                    'background: ' + (item.active ? this.getTextColor() : mix(this.getTextColor(), 16)) + ';' +
                    'color: ' + (item.active ? this.getBackgroundColor() : this.getTextColor()) + ';' +
                    'font-size: ' + tokens.css('fontSizes.xs') + ';' +
                    'font-weight: ' + tokens.css('fontWeights.bold') + ';' +
                    'padding: 2px 6px;' +
                    'border-radius: ' + tokens.css('borderRadius.sm') + ';' +
                    'margin-left: auto;' +
                    'flex-shrink: 0;'
                );
                navItem.appendChild(badge);
            }
            
            // Add hover effect
            navItem.addEventListener('mouseenter', () => {
                if (!item.active) {
                    navItem.style.background = this.getHoverColor();
                    navItem.style.color = this.getTextColor();
                }
            });
            
            navItem.addEventListener('mouseleave', () => {
                if (!item.active) {
                    navItem.style.background = 'transparent';
                    navItem.style.color = this.getMutedTextColor();
                }
            });
            
            // Add click handler
            navItem.addEventListener('click', (e) => {
                e.stopPropagation();
                
                this.dispatchEvent({
                    type: 'navItemClick',
                    bubbles: true,
                    detail: {
                        item: item,
                        index: index
                    }
                });
            });
            
            navItems.appendChild(navItem);
        });
        
        return navItems;
    }
    
    createFooterSection() {
        const footerSection = document.createElement('div');
        footerSection.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.css('spacing.sm') + ';' +
            'padding: ' + tokens.css('spacing.md') + ';' +
            'border-top: 1px solid ' + this.getBorderColor() + ';' +
            'margin-top: auto;' +
            'flex-shrink: 0;'
        );
        
        // Add footer content
        if (typeof this.footer === 'string') {
            const footerText = document.createElement('div');
            footerText.textContent = this.footer;
            footerText.style.cssText = (
                'font-size: ' + tokens.css('fontSizes.sm') + ';' +
                'color: ' + this.getMutedTextColor() + ';' +
                'text-align: center;' +
                'opacity: 0.7;'
            );
            footerSection.appendChild(footerText);
        } else if (this.footer && this.footer.items) {
            this.footer.items.forEach(item => {
                const footerItem = document.createElement('div');
                footerItem.style.cssText = (
                    'display: flex;' +
                    'align-items: center;' +
                    'gap: ' + tokens.css('spacing.sm') + ';' +
                    'padding: ' + tokens.css('spacing.sm') + ' ' + tokens.css('spacing.md') + ';' +
                    'color: ' + this.getMutedTextColor() + ';' +
                    'font-size: ' + tokens.css('fontSizes.sm') + ';' +
                    'cursor: ' + (item.onClick ? 'pointer' : 'default') + ';' +
                    'border-radius: ' + tokens.css('borderRadius.sm') + ';' +
                    'transition: all 150ms ease;'
                );
                
                if (item.icon) {
                    const icon = document.createElement('span');
                    icon.textContent = item.icon;
                    icon.style.cssText = (
                        'font-size: 16px;' +
                        'color: inherit;'
                    );
                    footerItem.appendChild(icon);
                }
                
                const label = document.createElement('span');
                label.textContent = item.label;
                label.style.cssText = (
                    'color: inherit;' +
                    'font-size: inherit;'
                );
                footerItem.appendChild(label);
                
                if (item.onClick) {
                    footerItem.addEventListener('click', (e) => {
                        e.stopPropagation();
                        item.onClick();
                    });
                    
                    footerItem.addEventListener('mouseenter', () => {
                        footerItem.style.background = this.getHoverColor();
                    });
                    
                    footerItem.addEventListener('mouseleave', () => {
                        footerItem.style.background = 'transparent';
                    });
                }
                
                footerSection.appendChild(footerItem);
            });
        }
        
        return footerSection;
    }
    
    createCollapseToggle() {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.setAttribute('aria-label', 'Toggle sidebar');
        toggle.setAttribute('aria-expanded', (!this.isCollapsed).toString());
        toggle.style.cssText = (
            'position: absolute;' +
            (this.position === 'left' ? 'right: ' + tokens.css('spacing.md') + ';' : 'left: ' + tokens.css('spacing.md') + ';') +
            'top: ' + tokens.css('spacing.md') + ';' +
            'background: transparent;' +
            'border: none;' +
            'color: ' + this.getTextColor() + ';' +
            'font-size: 18px;' +
            'cursor: pointer;' +
            'padding: ' + tokens.css('spacing.sm') + ';' +
            'border-radius: ' + tokens.css('borderRadius.sm') + ';' +
            'transition: all 150ms ease;' +
            'z-index: 10;'
        );
        
        toggle.innerHTML = this.position === 'left' ? (this.isCollapsed ? '▶' : '◀') : (this.isCollapsed ? '◀' : '▶');
        
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCollapse();
        });
        
        return toggle;
    }
    
    // Public methods
    setBrand(brand) {
        if (this.brand !== brand) {
            this.brand = brand;
            this.buildSidebar();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildSidebar();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildSidebar();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setPosition(position) {
        if (this.position !== position) {
            this.position = position;
            this.setupStyles();
            this.buildSidebar();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setItems(items) {
        this.items = items || [];
        this.buildSidebar();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setFooter(footer) {
        if (this.footer !== footer) {
            this.footer = footer;
            this.buildSidebar();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowBrand(showBrand) {
        if (this.showBrand !== showBrand) {
            this.showBrand = showBrand;
            this.buildSidebar();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowFooter(showFooter) {
        if (this.showFooter !== showFooter) {
            this.showFooter = showFooter;
            this.buildSidebar();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setWidth(width) {
        if (this.width !== width) {
            this.width = width;
            this.setupStyles();
            this.buildSidebar();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;
        
        // Update width when collapsed
        if (this.isCollapsed) {
            this.setStyle('width', '60px');
        } else {
            const sizeStyles = this.getSizeStyles();
            this.setStyle('width', sizeStyles.width);
        }
        
        this.buildSidebar();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'collapseToggle',
            bubbles: true,
            detail: {
                isCollapsed: this.isCollapsed
            }
        });
    }
    
    collapse() {
        if (!this.isCollapsed) {
            this.toggleCollapse();
        }
    }
    
    expand() {
        if (this.isCollapsed) {
            this.toggleCollapse();
        }
    }
    
    openOverlay() {
        if (this.overlay) {
            this.isOverlayOpen = true;
            this.setStyle('position', 'fixed');
            this.setStyle('top', '0');
            this.setStyle('left', '0');
            this.setStyle('right', '0');
            this.setStyle('bottom', '0');
            this.setStyle('z-index', '9999');
            this.setStyle('width', '280px');
            
            // Add backdrop
            const backdrop = document.createElement('div');
            backdrop.style.cssText = (
                'position: fixed;' +
                'top: 0;' +
                'left: 0;' +
                'right: 0;' +
                'bottom: 0;' +
                'background: rgba(0, 0, 0, 0.5);' +
                'z-index: 9998;'
            );
            backdrop.addEventListener('click', () => this.closeOverlay());
            document.body.appendChild(backdrop);
            this._backdrop = backdrop;
            
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
            
            this.dispatchEvent({
                type: 'overlayOpen',
                bubbles: true,
                detail: {}
            });
        }
    }
    
    closeOverlay() {
        if (this.overlay && this.isOverlayOpen) {
            this.isOverlayOpen = false;
            this.setStyle('position', 'relative');
            this.setStyle('top', 'auto');
            this.setStyle('left', 'auto');
            this.setStyle('right', 'auto');
            this.setStyle('bottom', 'auto');
            this.setStyle('z-index', '1');
            
            // Remove backdrop
            if (this._backdrop) {
                this._backdrop.remove();
                this._backdrop = null;
            }
            
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
            
            this.dispatchEvent({
                type: 'overlayClose',
                bubbles: true,
                detail: {}
            });
        }
    }
    
    // Static factory methods
    static createSidebar(id, options = {}) {
        return new Sidebar(id, options);
    }
    
    static createPrimarySidebar(id, options = {}) {
        return new Sidebar(id, { variant: 'primary', ...options });
    }
    
    static createSecondarySidebar(id, options = {}) {
        return new Sidebar(id, { variant: 'secondary', ...options });
    }
    
    static createSuccessSidebar(id, options = {}) {
        return new Sidebar(id, { variant: 'success', ...options });
    }
    
    static createWarningSidebar(id, options = {}) {
        return new Sidebar(id, { variant: 'warning', ...options });
    }
    
    static createErrorSidebar(id, options = {}) {
        return new Sidebar(id, { variant: 'error', ...options });
    }
    
    static createInfoSidebar(id, options = {}) {
        return new Sidebar(id, { variant: 'info', ...options });
    }
    
    static createLeftSidebar(id, options = {}) {
        return new Sidebar(id, { position: 'left', ...options });
    }
    
    static createRightSidebar(id, options = {}) {
        return new Sidebar(id, { position: 'right', ...options });
    }
    
    static createCollapsibleSidebar(id, options = {}) {
        return new Sidebar(id, { collapsible: true, ...options });
    }
    
    static createMiniSidebar(id, options = {}) {
        return new Sidebar(id, { mini: true, ...options });
    }
    
    static createOverlaySidebar(id, options = {}) {
        return new Sidebar(id, { overlay: true, ...options });
    }
    
    static createNavigationSidebar(id, options = {}) {
        return new Sidebar(id, {
            variant: 'secondary',
            position: 'left',
            collapsible: true,
            showBrand: true,
            ...options
        });
    }
    
    static createApplicationSidebar(id, options = {}) {
        return new Sidebar(id, {
            variant: 'primary',
            position: 'left',
            collapsible: true,
            showBrand: true,
            showFooter: true,
            ...options
        });
    }
    
    static createMobileSidebar(id, options = {}) {
        return new Sidebar(id, {
            variant: 'default',
            position: 'left',
            overlay: true,
            collapsible: true,
            width: '280px',
            ...options
        });
    }
    
    static createAdminSidebar(id, options = {}) {
        return new Sidebar(id, {
            variant: 'secondary',
            position: 'left',
            collapsible: true,
            showBrand: true,
            showFooter: true,
            ...options
        });
    }
    
    static createSettingsSidebar(id, options = {}) {
        return new Sidebar(id, {
            variant: 'default',
            position: 'right',
            collapsible: true,
            width: '300px',
            ...options
        });
    }
}
