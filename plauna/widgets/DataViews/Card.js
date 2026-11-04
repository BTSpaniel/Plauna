// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Card - Flexible content container widget for Plauna
 * Provides header, body, and footer slots with variant system
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf, TONES } from '../shared/appearance.js';

let _cardSequence = 0;

function _newCardId() {
    return `card-${Date.now()}-${++_cardSequence}`;
}

export class Card extends UINode {
    // Widget metadata
    static id = 'card';
    static name = 'Card';
    static category = 'dataviews';
    static icon = '📇';
    static description = 'Flexible content container';
    static tags = ['dataviews', 'card', 'container'];
    static dependencies = [];
    static optionValues = { variant: ['default', 'elevated', 'outlined', 'filled', 'interactive'], accent: TONES, size: ['xs', 'sm', 'md', 'lg', 'xl'], elevated: 'boolean', interactive: 'boolean' };
    
    static getDefaultOptions() {
        return {
            variant: 'default',
            size: 'md',
            elevated: false,
            interactive: false
        };
    }
    
    static create(container, options = {}) {
        const instance = new Card(_newCardId(), options);
        if (container && container instanceof HTMLElement) {
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    static stories() {
        return {
            'Default': { header: 'Render queue', body: '3 jobs waiting. Last frame finished 2 minutes ago.', footer: 'Updated 14:32' },
            'Elevated': { header: 'GPU memory', body: '1.8 GB of 4 GB in use across 12 textures.', elevated: true },
            'Interactive': { header: 'Open project', body: 'Particle Realms - 12 scenes', interactive: true },
            'Accent': { header: 'Realm status', body: 'All 6 shards online · 1,284 players.', footer: 'Checked 30 s ago', accent: 'success' },
            'Filled': { header: 'Draft', body: 'Unpublished changes to the lobby scene.', variant: 'filled' },
            'Outlined accent': { header: 'Featured', body: 'Hand-picked scenes from the community.', variant: 'outlined', accent: 'accent' }
        };
    }
    
    constructor(id = _newCardId(), options = {}) {
        super(id, 'card');
        
        // Card-specific properties
        this.variant = options.variant || 'default';
        this.size = options.size || 'md';
        this.elevated = options.elevated || false;
        this.interactive = options.interactive || false;
        this.accent = options.accent || null; // a tone for the top accent line
        this.padding = options.padding || null; // null = default for size
        
        // Content slots
        this.header = null;
        this.body = null;
        this.footer = null;
        this.image = null;
        this.actions = null;
        
        // Image properties
        this.imageSrc = options.imageSrc || null;
        this.imageAlt = options.imageAlt || '';
        this.imageAspectRatio = options.imageAspectRatio || '16/9';
        this.imagePosition = options.imagePosition || 'top'; // top, bottom, background
        
        // Set accessibility
        this.role = this.interactive ? 'article' : 'region';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build card structure
        this.buildCard();
        
        // Set initial content
        if (options.header) this.setHeader(options.header);
        if (options.body) this.setBody(options.body);
        if (options.footer) this.setFooter(options.footer);
        if (options.actions) this.setActions(options.actions);
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        const paddingStyles = this.getPaddingStyles();
        
        this.setStyles({
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--surface-card, #0f0f17)',
            border: '1px solid var(--border-light, #2a2a3a)',
            borderRadius: '14px',
            boxShadow: this.elevated ? 'var(--shadow-xl)' : 'var(--shadow-sm)',
            backgroundImage: this.accent ? `linear-gradient(90deg, ${toneOf(this.accent).base}, ${toneOf(this.accent).hover})` : 'none',
            backgroundSize: '100% 3px',
            backgroundRepeat: 'no-repeat',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            transition: 'transform 200ms var(--ease-out, ease), box-shadow 200ms ease, border-color 200ms ease',
            outline: 'none',
            cursor: this.interactive ? 'pointer' : 'default',
            ...sizeStyles,
            ...variantStyles,
            ...paddingStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                minWidth: '200px',
                maxWidth: '280px'
            },
            sm: {
                minWidth: '280px',
                maxWidth: '360px'
            },
            md: {
                minWidth: '320px',
                maxWidth: '400px'
            },
            lg: {
                minWidth: '360px',
                maxWidth: '480px'
            },
            xl: {
                minWidth: '400px',
                maxWidth: '560px'
            },
            fluid: {
                minWidth: 'auto',
                maxWidth: 'none'
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                border: `1px solid ${tokens.css('colors.border.medium')}`
            },
            elevated: {
                border: `1px solid ${tokens.css('colors.border.light')}`,
                boxShadow: tokens.css('shadows.xl')
            },
            outlined: {
                border: `1px solid ${this.accent ? toneOf(this.accent).border : 'var(--border-dark)'}`,
                boxShadow: 'none',
                backgroundColor: 'transparent'
            },
            filled: {
                border: '1px solid transparent',
                backgroundColor: 'var(--bg-tertiary)',
                boxShadow: 'none'
            },
            interactive: {
                border: `1px solid ${tokens.css('colors.border.medium')}`,
                cursor: 'pointer',
                transform: 'translateY(0)',
                boxShadow: tokens.css('shadows.md')
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    getPaddingStyles() {
        if (this.padding !== null) {
            return { padding: this.padding };
        }
        
        const paddings = {
            xs: { padding: tokens.css('spacing.sm') },
            sm: { padding: tokens.css('spacing.md') },
            md: { padding: tokens.css('spacing.lg') },
            lg: { padding: tokens.css('spacing.xl') },
            xl: { padding: tokens.css('spacing.xxl') }
        };
        return paddings[this.size] || paddings.md;
    }
    
    setupEventHandlers() {
        if (this.interactive) {
            this.addEventListener('mouseenter', () => {
                this.setStyle('transform', 'translateY(-2px)');
                this.setStyle('boxShadow', 'var(--shadow-xl)');
                this.setStyle('borderColor', toneOf(this.accent || 'primary').border);
            });
            
            this.addEventListener('mouseleave', () => {
                this.setStyle('transform', 'translateY(0)');
                this.setStyle('boxShadow', this.elevated ? 'var(--shadow-xl)' : 'var(--shadow-md)');
                this.setStyle('borderColor', 'var(--border-light, #2a2a3a)');
            });
            
            this.addEventListener('focus', () => {
                this.setStyle('transform', 'translateY(-2px)');
                this.setStyle('boxShadow', tokens.css('shadows.xl'));
                this.setStyle('border-color', toneOf('primary').base);
            });
            
            this.addEventListener('blur', () => {
                this.setStyle('transform', 'translateY(0)');
                this.setStyle('boxShadow', this.elevated ? tokens.css('shadows.lg') : tokens.css('shadows.md'));
                this.setStyle('border-color', tokens.css('colors.border.medium'));
            });
        }
    }
    
    buildCard() {
        // Clear existing content
        this.clearChildren();
        
        // Background image (if specified)
        if (this.imageSrc && this.imagePosition === 'background') {
            this.createBackgroundImage();
        }
        
        // Top image (if specified)
        if (this.imageSrc && this.imagePosition === 'top') {
            this.createTopImage();
        }
        
        // Header
        this.header = new UINode(`${this.id}-header`, 'header');
        this.header.setStyles({
            display: this.hasContent('header') ? 'block' : 'none',
            fontSize: '15px',
            fontWeight: '650',
            letterSpacing: '-0.005em',
            color: 'var(--text-primary)',
            paddingBottom: tokens.css('spacing.md'),
            borderBottom: this.hasContent('body') ? `1px solid ${tokens.css('colors.border.subtle')}` : 'none'
        });
        this.appendChild(this.header);
        
        // Body (main content area)
        this.body = new UINode(`${this.id}-body`, 'div');
        this.body.setStyles({
            display: 'flex',
            flexDirection: 'column',
            flex: '1',
            gap: tokens.css('spacing.sm'),
            fontSize: '14px',
            lineHeight: '1.55',
            color: 'var(--text-secondary)'
        });
        this.appendChild(this.body);
        
        // Footer
        this.footer = new UINode(`${this.id}-footer`, 'footer');
        this.footer.setStyles({
            display: this.hasContent('footer') ? 'block' : 'none',
            fontSize: '12px',
            color: 'var(--text-tertiary)',
            paddingTop: this.hasContent('body') ? tokens.css('spacing.md') : '0',
            borderTop: this.hasContent('body') ? `1px solid ${tokens.css('colors.border.subtle')}` : 'none'
        });
        this.appendChild(this.footer);
        
        // Actions
        this.actions = new UINode(`${this.id}-actions`, 'div');
        this.actions.setStyles({
            display: this.hasContent('actions') ? 'flex' : 'none',
            justifyContent: 'flex-end',
            gap: tokens.css('spacing.sm'),
            paddingTop: this.hasContent('body') || this.hasContent('footer') ? tokens.css('spacing.md') : '0',
            borderTop: (this.hasContent('body') || this.hasContent('footer')) ? `1px solid ${tokens.css('colors.border.subtle')}` : 'none'
        });
        this.appendChild(this.actions);
        
        // Bottom image (if specified)
        if (this.imageSrc && this.imagePosition === 'bottom') {
            this.createBottomImage();
        }
    }
    
    createBackgroundImage() {
        this.setStyle('position', 'relative');
        this.setStyle('backgroundImage', `url(${this.imageSrc})`);
        this.setStyle('backgroundSize', 'cover');
        this.setStyle('backgroundPosition', 'center');
        this.setStyle('backgroundRepeat', 'no-repeat');
        
        // Add overlay for better text readability
        const overlay = new UINode(`${this.id}-overlay`, 'div');
        overlay.setStyles({
            position: 'absolute',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0',
            background: 'rgba(0, 0, 0, 0.4)',
            zIndex: '1'
        });
        this.insertBefore(overlay, this.firstChild);
        
        // Ensure content is above overlay
        this.children.forEach(child => {
            if (child !== overlay) {
                child.setStyle('position', 'relative');
                child.setStyle('zIndex', '2');
            }
        });
    }
    
    createTopImage() {
        this.image = new UINode(`${this.id}-image`, 'img');
        this.image.setStyles({
            width: '100%',
            height: 'auto',
            maxHeight: '200px',
            objectFit: 'cover',
            display: 'block'
        });
        this.insertBefore(this.image, this.firstChild);
        
        // Set image properties
        if (this.imageSrc) {
            this.image.element.src = this.imageSrc;
            this.image.element.alt = this.imageAlt;
        }
    }
    
    createBottomImage() {
        this.image = new UINode(`${this.id}-image`, 'img');
        this.image.setStyles({
            width: '100%',
            height: 'auto',
            maxHeight: '200px',
            objectFit: 'cover',
            display: 'block'
        });
        this.appendChild(this.image);
        
        // Set image properties
        if (this.imageSrc) {
            this.image.element.src = this.imageSrc;
            this.image.element.alt = this.imageAlt;
        }
    }
    
    hasContent(slot) {
        // A slot has content when it holds child nodes or text
        const node = { header: this.header, body: this.body, footer: this.footer, actions: this.actions }[slot];
        return Boolean(node) && (node.children.length > 0 || Boolean(node.textContent));
    }
    
    setHeader(content) {
        this.header.clearChildren();
        this.header.textContent = '';
        if (typeof content === 'string') {
            this.header.textContent = content;
        } else if (content instanceof UINode) {
            this.header.appendChild(content);
        }
        this.updateSlotStyles('header');
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setBody(content) {
        this.body.clearChildren();
        this.body.textContent = '';
        if (typeof content === 'string') {
            this.body.textContent = content;
        } else if (content instanceof UINode) {
            this.body.appendChild(content);
        }
        this.updateSlotStyles('body');
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setFooter(content) {
        this.footer.clearChildren();
        this.footer.textContent = '';
        if (typeof content === 'string') {
            this.footer.textContent = content;
        } else if (content instanceof UINode) {
            this.footer.appendChild(content);
        }
        this.updateSlotStyles('footer');
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setActions(actions) {
        this.actions.clearChildren();
        if (Array.isArray(actions)) {
            actions.forEach(action => {
                if (typeof action === 'string') {
                    // Create simple text button
                    const button = new UINode(`${this.id}-action-${action}`, 'button');
                    button.textContent = action;
                    button.setStyles({
                        padding: `${tokens.css('spacing.xs')} ${tokens.css('spacing.md')}`,
                        backgroundColor: toneOf('primary').base,
                        color: toneOf('primary').on,
                        border: 'none',
                        borderRadius: tokens.css('borderRadius.sm'),
                        fontSize: tokens.css('fontSizes.sm'),
                        fontWeight: tokens.css('fontWeights.medium'),
                        cursor: 'pointer',
                        transition: 'all 150ms ease'
                    });
                    this.actions.appendChild(button);
                } else if (action instanceof UINode) {
                    this.actions.appendChild(action);
                }
            });
        } else if (actions instanceof UINode) {
            this.actions.appendChild(actions);
        }
        this.updateSlotStyles('actions');
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    updateSlotStyles(slot) {
        const hasContent = this.hasContent(slot);
        const slotNode = this[slot];
        
        if (!slotNode) return;
        
        switch (slot) {
            case 'header':
                slotNode.setStyle('display', hasContent ? 'block' : 'none');
                slotNode.setStyle('paddingBottom', hasContent && this.hasContent('body') ? tokens.css('spacing.md') : '0');
                slotNode.setStyle('borderBottom', hasContent && this.hasContent('body') ? `1px solid ${tokens.css('colors.border.subtle')}` : 'none');
                break;
            case 'body':
                // Body is always visible as the main content area
                break;
            case 'footer':
                slotNode.setStyle('display', hasContent ? 'block' : 'none');
                slotNode.setStyle('paddingTop', hasContent && this.hasContent('body') ? tokens.css('spacing.md') : '0');
                slotNode.setStyle('borderTop', hasContent && this.hasContent('body') ? `1px solid ${tokens.css('colors.border.subtle')}` : 'none');
                break;
            case 'actions':
                slotNode.setStyle('display', hasContent ? 'flex' : 'none');
                slotNode.setStyle('paddingTop', hasContent && (this.hasContent('body') || this.hasContent('footer')) ? tokens.css('spacing.md') : '0');
                slotNode.setStyle('borderTop', hasContent && (this.hasContent('body') || this.hasContent('footer')) ? `1px solid ${tokens.css('colors.border.subtle')}` : 'none');
                break;
        }
    }
    
    setImage(src, alt = '', position = 'top') {
        this.imageSrc = src;
        this.imageAlt = alt;
        this.imagePosition = position;
        this.buildCard();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setVariant(variant) {
        this.variant = variant;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }
    
    setSize(size) {
        this.size = size;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setElevated(elevated) {
        this.elevated = elevated;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }
    
    setInteractive(interactive) {
        this.interactive = interactive;
        this.role = interactive ? 'article' : 'region';
        this.setupStyles();
        this.setupEventHandlers();
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
    }
    
    setPadding(padding) {
        this.padding = padding;
        this.setupStyles();
        this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }
    
    // Static factory methods for common card types
    static createProductCard(id, product, options = {}) {
        const card = new Card(id, {
            variant: 'elevated',
            size: 'md',
            interactive: true,
            imageSrc: product.image,
            imageAlt: product.name,
            ...options
        });
        
        // Header with title
        const header = new UINode(`${id}-title`, 'h3');
        header.textContent = product.name;
        header.setStyles({
            margin: '0',
            fontSize: tokens.css('fontSizes.lg'),
            fontWeight: tokens.css('fontWeights.semibold'),
            color: tokens.css('colors.text.primary')
        });
        card.setHeader(header);
        
        // Body with description
        card.setBody(product.description);
        
        // Footer with price
        const footer = new UINode(`${id}-price`, 'div');
        footer.textContent = `$${product.price}`;
        footer.setStyles({
            fontSize: tokens.css('fontSizes.xl'),
            fontWeight: tokens.css('fontWeights.bold'),
            color: toneOf('primary').text
        });
        card.setFooter(footer);
        
        return card;
    }
    
    static createProfileCard(id, profile, options = {}) {
        const card = new Card(id, {
            variant: 'default',
            size: 'md',
            imageSrc: profile.avatar,
            imageAlt: profile.name,
            ...options
        });
        
        // Header with name
        const header = new UINode(`${id}-name`, 'h3');
        header.textContent = profile.name;
        header.setStyles({
            margin: '0',
            fontSize: tokens.css('fontSizes.lg'),
            fontWeight: tokens.css('fontWeights.semibold'),
            color: tokens.css('colors.text.primary'),
            textAlign: 'center'
        });
        card.setHeader(header);
        
        // Body with bio
        card.setBody(profile.bio);
        
        // Footer with status
        const footer = new UINode(`${id}-status`, 'div');
        footer.textContent = profile.status;
        footer.setStyles({
            fontSize: tokens.css('fontSizes.sm'),
            color: tokens.css('colors.text.secondary'),
            textAlign: 'center',
            fontStyle: 'italic'
        });
        card.setFooter(footer);
        
        return card;
    }
}
