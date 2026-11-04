// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Alert - Alert message widget for Plauna
 * Provides alert functionality with multiple variants and dismissible options
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf, TONES } from '../shared/appearance.js';

let _alertSequence = 0;

function _newAlertId() {
    return `alert-${Date.now()}-${++_alertSequence}`;
}

export class Alert extends UINode {
    // Widget metadata
    static id = 'alert';
    static name = 'Alert';
    static category = 'feedback';
    static icon = '⚠️';
    static description = 'Alert notification';
    static tags = ['feedback', 'alert', 'notification'];
    static dependencies = [];
    static optionValues = { variant: ['info', 'success', 'warning', 'error', 'primary', 'accent', 'default'], appearance: ['soft', 'solid', 'outline', 'accent'], size: ['xs', 'sm', 'md', 'lg', 'xl'], dismissible: 'boolean' };
    
    static getDefaultOptions() {
        return {
            message: '',
            variant: 'info',
            closable: true,
            showIcon: true
        };
    }
    
    static create(container, options = {}) {
        const instance = new Alert(_newAlertId(), options);
        if (container && container instanceof HTMLElement) {
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    static stories() {
        return {
            'Info': { variant: 'info', title: 'Shaders compiling', message: '42 of 60 pipelines are ready.' },
            'Success': { variant: 'success', title: 'Scene saved', message: 'All changes are on disk.' },
            'Warning': { variant: 'warning', title: 'Low GPU memory', message: 'Texture streaming is paused.', dismissible: true },
            'Error': { variant: 'error', title: 'Import failed', message: 'terrain.ktx2 is not a valid KTX2 file.', action: { label: 'Retry' } },
            'Solid': { variant: 'success', appearance: 'solid', title: 'Deployed', message: 'Build 418 is live on all realms.' },
            'Accent bar': { variant: 'accent', appearance: 'accent', title: 'New in 0.3', message: 'Twenty new widgets and a shared look for all of them.' },
            'Outline': { variant: 'warning', appearance: 'outline', title: 'Unsaved changes', message: 'Three materials changed since the last save.' }
        };
    }
    
    constructor(id = _newAlertId(), options = {}) {
        super(id, 'alert');
        
        // Alert-specific properties
        this.message = options.message || '';
        this.title = options.title || '';
        this.appearance = options.appearance || 'soft'; // soft, solid, outline, accent
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error, info
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.dismissible = options.dismissible || false;
        this.icon = typeof options.icon === 'string' && options.icon ? options.icon : null;
        this.action = options.action || null;
        this.timeout = options.timeout || null;
        this.showIcon = options.showIcon ?? (options.icon !== false);
        
        // State management
        this.visible = true;
        this.timeoutId = null;
        
        // Set accessibility
        this.role = 'alert';
        this.ariaLive = 'polite';
        this.ariaAtomic = 'true';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build alert structure
        this.buildAlert();
        
        // Auto-dismiss if timeout is set
        if (this.timeout && this.timeout > 0) {
            this.setTimeout(this.timeout);
        }
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'flex',
            alignItems: 'flex-start',
            gap: tokens.css('spacing.md'),
            padding: this.getPadding(),
            backgroundColor: this.getBackgroundColor(),
            color: this.getTextColor(),
            border: '1px solid ' + this.getBorderColor(),
            borderRadius: tokens.css('borderRadius.md'),
            fontSize: 'inherit',
            fontWeight: tokens.css('fontWeights.medium'),
            outline: 'none',
            position: 'relative',
            transition: 'all 150ms ease',
            ...sizeStyles,
            ...variantStyles
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
        const c = toneOf(this.variant === 'default' ? 'neutral' : this.variant);
        switch (this.appearance) {
            case 'solid':
                return { backgroundColor: c.base, color: c.on, borderColor: 'transparent', boxShadow: `0 8px 24px -12px ${c.glow}` };
            case 'outline':
                return { backgroundColor: 'var(--surface-card, #0f0f17)', color: 'var(--text-primary)', borderColor: c.border, boxShadow: 'none' };
            case 'accent':
                return { backgroundColor: 'var(--surface-card, #0f0f17)', color: 'var(--text-primary)', borderColor: 'var(--border-light)', boxShadow: `inset 4px 0 0 ${c.base}` };
            case 'soft':
            default:
                return { backgroundColor: c.soft, color: 'var(--text-primary)', borderColor: c.subtleBorder, boxShadow: 'none' };
        }
    }

    setAppearance(appearance) {
        this.appearance = appearance || 'soft';
        this.setupStyles?.();
        this.setStyles(this.getVariantStyles());
    }

    getBackgroundColor() {
        return this.getVariantStyles().backgroundColor;
    }
    
    getTextColor() {
        return this.getVariantStyles().color;
    }
    
    getBorderColor() {
        return this.getVariantStyles().borderColor;
    }
    
    getIconColor() {
        const c = toneOf(this.variant === 'default' ? 'neutral' : this.variant);
        return this.appearance === 'solid' ? c.on : c.base;
    }
    
    setupEventHandlers() {
        this.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.dismiss();
            }
        });
    }
    
    buildAlert() {
        this.clearChildren();
        
        // Create icon if enabled
        if (this.showIcon) {
            const icon = this.createIcon();
            this.appendElement(icon);
        }
        
        // Create content container
        const contentContainer = document.createElement('div');
        contentContainer.style.cssText = (
            'flex: 1;' +
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.css('spacing.xs') + ';'
        );
        
        // Add title if present
        if (this.title) {
            const titleElement = document.createElement('div');
            titleElement.textContent = this.title;
            titleElement.style.cssText = (
                'font-weight: ' + tokens.css('fontWeights.semibold') + ';' +
                'font-size: ' + tokens.css('fontSizes.lg') + ';' +
                'color: inherit;' +
                'line-height: 1.2;'
            );
            contentContainer.appendChild(titleElement);
        }
        
        // Add message
        const messageElement = document.createElement('div');
        messageElement.textContent = this.message;
        messageElement.style.cssText = (
            'color: inherit;' +
            'line-height: 1.4;' +
            'font-size: inherit;'
        );
        contentContainer.appendChild(messageElement);
        
        this.appendElement(contentContainer);
        
        // Add dismiss button if dismissible
        if (this.dismissible) {
            const dismissButton = this.createDismissButton();
            this.appendElement(dismissButton);
        }
        
        // Add action button if present
        if (this.action) {
            const actionButton = this.createActionButton();
            this.appendElement(actionButton);
        }
    }
    
    createIcon() {
        const icon = document.createElement('div');
        icon.style.cssText = (
            'width: 20px;' +
            'height: 20px;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'flex-shrink: 0;' +
            'margin-top: 2px;'
        );
        
        // Get icon based on variant if no custom icon is provided
        const iconText = this.icon || this.getDefaultIcon();
        icon.textContent = iconText;
        icon.style.color = this.getIconColor();
        
        return icon;
    }
    
    getDefaultIcon() {
        const variantIcons = {
            default: 'ℹ️',
            primary: 'ℹ️',
            secondary: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌',
            info: 'ℹ️'
        };
        return variantIcons[this.variant] || variantIcons.default;
    }
    
    createDismissButton() {
        const dismissButton = document.createElement('button');
        dismissButton.type = 'button';
        dismissButton.setAttribute('aria-label', 'Dismiss');
        dismissButton.textContent = '×';
        dismissButton.style.cssText = (
            'width: 20px;' +
            'height: 20px;' +
            'background: transparent;' +
            'border: none;' +
            'color: ' + tokens.css('colors.text.secondary') + ';' +
            'font-size: 18px;' +
            'font-weight: bold;' +
            'cursor: pointer;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'border-radius: 50%;' +
            'transition: all 150ms ease;' +
            'flex-shrink: 0;' +
            'margin-top: 2px;'
        );
        
        dismissButton.addEventListener('mouseenter', () => {
            dismissButton.style.background = 'rgba(0, 0, 0, 0.1)';
            dismissButton.style.color = tokens.css('colors.text.primary');
        });
        
        dismissButton.addEventListener('mouseleave', () => {
            dismissButton.style.background = 'transparent';
            dismissButton.style.color = tokens.css('colors.text.secondary');
        });
        
        dismissButton.addEventListener('click', () => {
            this.dismiss();
        });
        
        return dismissButton;
    }
    
    createActionButton() {
        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.textContent = this.action.label || 'Action';
        actionButton.style.cssText = (
            'background: transparent;' +
            'color: ' + this.getIconColor() + ';' +
            'border: 1px solid ' + this.getBorderColor() + ';' +
            'border-radius: ' + tokens.css('borderRadius.sm') + ';' +
            'padding: ' + tokens.css('spacing.xs') + ' ' + tokens.css('spacing.sm') + ';' +
            'font-size: ' + tokens.css('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.css('fontWeights.medium') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;' +
            'flex-shrink: 0;' +
            'margin-top: 2px;'
        );
        
        actionButton.addEventListener('mouseenter', () => {
            actionButton.style.background = this.getBackgroundColor();
            actionButton.style.color = this.getTextColor();
        });
        
        actionButton.addEventListener('mouseleave', () => {
            actionButton.style.background = 'transparent';
            actionButton.style.color = this.getIconColor();
        });
        
        actionButton.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.action.onClick && typeof this.action.onClick === 'function') {
                this.action.onClick({
                    message: this.message,
                    title: this.title,
                    variant: this.variant
                });
            }
            
            this.dispatchEvent({
                type: 'action',
                bubbles: true,
                detail: {
                    message: this.message,
                    title: this.title,
                    variant: this.variant
                }
            });
        });
        
        return actionButton;
    }
    
    // Public methods
    setMessage(message) {
        if (this.message !== message) {
            this.message = message;
            const messageElement = this.element?.querySelector('div div:last-child');
            if (messageElement) {
                messageElement.textContent = message;
            }
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setTitle(title) {
        if (this.title !== title) {
            this.title = title;
            this.buildAlert();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildAlert();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildAlert();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setDismissible(dismissible) {
        if (this.dismissible !== dismissible) {
            this.dismissible = dismissible;
            this.buildAlert();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setIcon(icon) {
        if (this.icon !== icon) {
            this.icon = icon;
            this.buildAlert();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowIcon(showIcon) {
        if (this.showIcon !== showIcon) {
            this.showIcon = showIcon;
            this.buildAlert();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setAction(action) {
        if (this.action !== action) {
            this.action = action;
            this.buildAlert();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setTimeout(timeout) {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }
        
        if (timeout && timeout > 0) {
            this.timeoutId = setTimeout(() => {
                this.dismiss();
            }, timeout);
        }
    }
    
    show() {
        if (!this.visible) {
            this.visible = true;
            this.setStyle('display', 'flex');
            this.setStyle('opacity', '1');
            this.setStyle('transform', 'translateY(0)');
            this.markDirty(DIRTY.PAINT);
            
            this.dispatchEvent({
                type: 'show',
                bubbles: true,
                detail: {
                    message: this.message,
                    title: this.title,
                    variant: this.variant
                }
            });
        }
    }
    
    dismiss() {
        if (this.visible) {
            this.visible = false;
            this.setStyle('opacity', '0');
            this.setStyle('transform', 'translateY(-10px)');
            
            setTimeout(() => {
                this.setStyle('display', 'none');
                this.markDirty(DIRTY.PAINT);
            }, 150);
            
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
            
            this.dispatchEvent({
                type: 'dismiss',
                bubbles: true,
                detail: {
                    message: this.message,
                    title: this.title,
                    variant: this.variant
                }
            });
        }
    }
    
    // Static factory methods
    static createAlert(id, options = {}) {
        return new Alert(id, options);
    }
    
    static createSuccessAlert(id, message, options = {}) {
        return new Alert(id, { variant: 'success', message, ...options });
    }
    
    static createWarningAlert(id, message, options = {}) {
        return new Alert(id, { variant: 'warning', message, ...options });
    }
    
    static createErrorAlert(id, message, options = {}) {
        return new Alert(id, { variant: 'error', message, ...options });
    }
    
    static createInfoAlert(id, message, options = {}) {
        return new Alert(id, { variant: 'info', message, ...options });
    }
    
    static createPrimaryAlert(id, message, options = {}) {
        return new Alert(id, { variant: 'primary', message, ...options });
    }
    
    static createSecondaryAlert(id, message, options = {}) {
        return new Alert(id, { variant: 'secondary', message, ...options });
    }
    
    static createDismissibleAlert(id, message, options = {}) {
        return new Alert(id, { message, dismissible: true, ...options });
    }
    
    static createTitledAlert(id, title, message, options = {}) {
        return new Alert(id, { title, message, ...options });
    }
    
    static createAutoDismissAlert(id, message, timeout, options = {}) {
        return new Alert(id, { message, timeout, ...options });
    }
    
    static createActionAlert(id, message, action, options = {}) {
        return new Alert(id, { message, action, ...options });
    }
    
    static createNotificationAlert(id, message, options = {}) {
        return new Alert(id, {
            variant: 'info',
            dismissible: true,
            timeout: 5000,
            message,
            ...options
        });
    }
    
    static createToastAlert(id, message, options = {}) {
        return new Alert(id, {
            variant: 'default',
            dismissible: true,
            timeout: 3000,
            message,
            ...options
        });
    }
}
