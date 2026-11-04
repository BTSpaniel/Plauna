// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Toast - Notification toast widget for Plauna
 * Provides toast functionality with multiple variants and auto-dismiss
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf, mix, OVERLAY, TONES } from '../shared/appearance.js';

let _toastSequence = 0;

function _newToastId() {
    return `toast-${Date.now()}-${++_toastSequence}`;
}

export class Toast extends UINode {
    // Widget metadata
    static id = 'toast';
    static name = 'Toast';
    static category = 'feedback';
    static icon = '🍞';
    static description = 'Toast notification';
    static tags = ['feedback', 'toast', 'notification'];
    static optionValues = { variant: ['default', ...TONES, 'secondary', 'error'], size: ['xs', 'sm', 'md', 'lg', 'xl'] };
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            message: '',
            variant: 'info',
            duration: 3000,
            closable: true
        };
    }

    static stories() {
        return {
            'Info': {
                title: 'Heads up',
                message: 'This is an informational toast.',
                variant: 'info',
                position: 'inline',
                duration: 0,
                dismissible: true
            },
            'Success': {
                title: 'Done',
                message: 'Your changes were saved successfully.',
                variant: 'success',
                position: 'inline',
                duration: 0,
                dismissible: true
            },
            'Warning': {
                title: 'Careful',
                message: 'Something needs your attention.',
                variant: 'warning',
                position: 'inline',
                duration: 0,
                dismissible: true
            },
            'Error': {
                title: 'Error',
                message: 'An operation failed and needs retrying.',
                variant: 'error',
                position: 'inline',
                duration: 0,
                dismissible: true
            },
            'Loading': {
                title: 'Working',
                message: 'Please wait while we finish this step.',
                variant: 'info',
                position: 'inline',
                duration: 0,
                dismissible: true,
                showProgress: true
            }
        };
    }

    static create(container, options = {}) {
        const instance = new Toast(_newToastId(), options);
        if (container && container instanceof HTMLElement) {
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newToastId(), options = {}) {
        super(id, 'toast');
        
        // Toast-specific properties
        this.message = options.message || '';
        this.title = options.title || '';
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error, info
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.position = options.position || 'top-right'; // top-left, top-center, top-right, bottom-left, bottom-center, bottom-right
        this.duration = options.duration || 5000;
        this.dismissible = options.dismissible !== false;
        this.icon = options.icon || null;
        this.action = options.action || null;
        this.showProgress = options.showProgress || false;
        
        // State management
        this.visible = false;
        this.timeoutId = null;
        this.progressInterval = null;
        this.startTime = null;
        
        // Set accessibility
        this.role = 'status';
        this.ariaLive = 'polite';
        this.ariaAtomic = 'true';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build toast structure
        this.buildToast();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        const positionStyles = this.getPositionStyles();
        
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
            // position 'inline' places the toast in the page flow instead of a screen corner
            position: this.position === 'inline' ? 'relative' : 'fixed',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.1)',
            zIndex: this.position === 'inline' ? 'auto' : 9999,
            minWidth: this.position === 'inline' ? '0' : '300px',
            maxWidth: '500px',
            transition: 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)',
            transform: this.position === 'inline' ? 'none' : 'translateX(100%) translateY(0)',
            opacity: '0',
            ...sizeStyles,
            ...variantStyles,
            ...positionStyles
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

    // default is a floating surface; a tone is a solid fill with the tone's on-colour text
    toneColors() {
        return this.variant === 'default' ? null : toneOf(this.variant);
    }

    /** The text colour, mixed lighter for the toast's overlays (progress track, button hover). */
    inkColor(percent = 100) {
        const ink = this.toneColors()?.on ?? 'var(--text-primary, #e4e4e7)';
        return percent === 100 ? ink : mix(ink, percent);
    }
    
    getPositionStyles() {
        const positions = {
            'top-left': {
                top: tokens.css('spacing.lg'),
                left: tokens.css('spacing.lg')
            },
            'top-center': {
                top: tokens.css('spacing.lg'),
                left: '50%',
                transform: 'translateX(-50%)'
            },
            'top-right': {
                top: tokens.css('spacing.lg'),
                right: tokens.css('spacing.lg')
            },
            'bottom-left': {
                bottom: tokens.css('spacing.lg'),
                left: tokens.css('spacing.lg')
            },
            'bottom-center': {
                bottom: tokens.css('spacing.lg'),
                left: '50%',
                transform: 'translateX(-50%)'
            },
            'bottom-right': {
                bottom: tokens.css('spacing.lg'),
                right: tokens.css('spacing.lg')
            },
            inline: {}
        };
        return positions[this.position] || positions['top-right'];
    }
    
    getBackgroundColor() {
        return this.toneColors()?.base ?? OVERLAY.backgroundColor;
    }
    
    getTextColor() {
        return this.inkColor();
    }
    
    getBorderColor() {
        return this.toneColors()?.base ?? OVERLAY.borderColor;
    }
    
    getIconColor() {
        if (this.variant === 'default') {
            return tokens.css('colors.text.secondary');
        }
        return this.inkColor();
    }
    
    setupEventHandlers() {
        this.addEventListener('mouseenter', () => {
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
        });
        
        this.addEventListener('mouseleave', () => {
            if (this.visible && this.duration > 0) {
                this.resetTimeout();
            }
        });
        
        this.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.dismiss();
            }
        });
    }
    
    buildToast() {
        this.clearChildren();
        
        // Create progress bar if enabled
        if (this.showProgress) {
            const progressBar = document.createElement('div');
            progressBar.style.cssText = (
                'position: absolute;' +
                'bottom: 0;' +
                'left: 0;' +
                'right: 0;' +
                'height: 3px;' +
                'background: ' + this.inkColor(20) + ';' +
                'border-radius: 0 0 ' + tokens.css('borderRadius.md') + ' ' + tokens.css('borderRadius.md') + ';'
            );
            
            const progressFill = document.createElement('div');
            progressFill.style.cssText = (
                'height: 100%;' +
                'background: ' + (this.variant === 'default' ? tokens.css('colors.text.secondary') : this.inkColor()) + ';' +
                'width: 100%;' +
                'border-radius: 0 0 calc(' + tokens.css('borderRadius.md') + ' - 1px) calc(' + tokens.css('borderRadius.md') + ' - 1px);' +
                'transition: width linear;' +
                'transform-origin: left;'
            );
            
            progressBar.appendChild(progressFill);
            this.appendElement(progressBar);
            this.progressFill = progressFill;
        }
        
        // Create icon
        const icon = this.createIcon();
        this.appendElement(icon);
        
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
                'font-size: ' + tokens.css('fontSizes.sm') + ';' +
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
        
        // Add action button if present
        if (this.action) {
            const actionButton = this.createActionButton();
            this.appendElement(actionButton);
        }
        
        // Add dismiss button if dismissible
        if (this.dismissible) {
            const dismissButton = this.createDismissButton();
            this.appendElement(dismissButton);
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
    
    createActionButton() {
        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.textContent = this.action.label || 'Action';
        actionButton.style.cssText = (
            'background: transparent;' +
            'color: inherit;' +
            'border: 1px solid ' + (this.variant === 'default' ? tokens.css('colors.border.light') : this.inkColor(30)) + ';' +
            'border-radius: ' + tokens.css('borderRadius.sm') + ';' +
            'padding: ' + tokens.css('spacing.xs') + ' ' + tokens.css('spacing.sm') + ';' +
            'font-size: ' + tokens.css('fontSizes.xs') + ';' +
            'font-weight: ' + tokens.css('fontWeights.medium') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;' +
            'flex-shrink: 0;' +
            'margin-top: 2px;'
        );
        
        actionButton.addEventListener('mouseenter', () => {
            actionButton.style.background = this.inkColor(10);
        });
        
        actionButton.addEventListener('mouseleave', () => {
            actionButton.style.background = 'transparent';
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
            'color: inherit;' +
            'font-size: 18px;' +
            'font-weight: bold;' +
            'cursor: pointer;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'border-radius: 50%;' +
            'transition: all 150ms ease;' +
            'flex-shrink: 0;' +
            'margin-top: 2px;' +
            'opacity: 0.7;'
        );
        
        dismissButton.addEventListener('mouseenter', () => {
            dismissButton.style.background = this.inkColor(10);
            dismissButton.style.opacity = '1';
        });
        
        dismissButton.addEventListener('mouseleave', () => {
            dismissButton.style.background = 'transparent';
            dismissButton.style.opacity = '0.7';
        });
        
        dismissButton.addEventListener('click', () => {
            this.dismiss();
        });
        
        return dismissButton;
    }
    
    // Public methods
    show() {
        if (!this.visible) {
            this.visible = true;
            this.startTime = Date.now();
            
            // Apply position styles
            const positionStyles = this.getPositionStyles();
            Object.keys(positionStyles).forEach(key => {
                this.setStyle(key, positionStyles[key]);
            });
            
            // Animate in
            requestAnimationFrame(() => {
                this.setStyle('opacity', '1');
                
                if (this.position === 'inline') {
                    this.setStyle('transform', 'none');
                } else if (this.position.includes('right')) {
                    this.setStyle('transform', 'translateX(0)');
                } else if (this.position.includes('left')) {
                    this.setStyle('transform', 'translateX(0)');
                } else {
                    this.setStyle('transform', 'translateX(-50%)');
                }
            });
            
            // Start progress animation if enabled
            if (this.showProgress && this.progressFill) {
                this.startProgress();
            }
            
            // Auto-dismiss after duration
            if (this.duration > 0) {
                this.resetTimeout();
            }
            
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
            
            // Clear timeout
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
            
            // Clear progress interval
            if (this.progressInterval) {
                clearInterval(this.progressInterval);
                this.progressInterval = null;
            }
            
            // Animate out
            this.setStyle('opacity', '0');
            
            if (this.position.includes('right')) {
                this.setStyle('transform', 'translateX(100%)');
            } else if (this.position.includes('left')) {
                this.setStyle('transform', 'translateX(-100%)');
            } else {
                this.setStyle('transform', 'translateX(-50%) translateY(-20px)');
            }
            
            setTimeout(() => {
                this.setStyle('display', 'none');
                this.markDirty(DIRTY.PAINT);
            }, 300);
            
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
    
    resetTimeout() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }
        
        if (this.duration > 0) {
            this.timeoutId = setTimeout(() => {
                this.dismiss();
            }, this.duration);
        }
    }
    
    startProgress() {
        if (this.progressFill && this.startTime) {
            this.progressInterval = setInterval(() => {
                const elapsed = Date.now() - this.startTime;
                const progress = Math.max(0, 1 - (elapsed / this.duration));
                this.progressFill.style.width = (progress * 100) + '%';
                
                if (progress <= 0) {
                    clearInterval(this.progressInterval);
                    this.progressInterval = null;
                }
            }, 50);
        }
    }
    
    setMessage(message) {
        if (this.message !== message) {
            this.message = message;
            const messageElement = this.element?.querySelector('div div div:last-child');
            if (messageElement) {
                messageElement.textContent = message;
            }
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setTitle(title) {
        if (this.title !== title) {
            this.title = title;
            this.buildToast();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildToast();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildToast();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setPosition(position) {
        if (this.position !== position) {
            this.position = position;
            const positionStyles = this.getPositionStyles();
            Object.keys(positionStyles).forEach(key => {
                this.setStyle(key, positionStyles[key]);
            });
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setDuration(duration) {
        if (this.duration !== duration) {
            this.duration = duration;
            if (this.visible && duration > 0) {
                this.resetTimeout();
            }
        }
    }
    
    setDismissible(dismissible) {
        if (this.dismissible !== dismissible) {
            this.dismissible = dismissible;
            this.buildToast();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setIcon(icon) {
        if (this.icon !== icon) {
            this.icon = icon;
            this.buildToast();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setAction(action) {
        if (this.action !== action) {
            this.action = action;
            this.buildToast();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowProgress(showProgress) {
        if (this.showProgress !== showProgress) {
            this.showProgress = showProgress;
            this.buildToast();
            if (this.visible && showProgress) {
                this.startProgress();
            }
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    // Static factory methods
    static createToast(id, options = {}) {
        return new Toast(id, options);
    }
    
    static createSuccessToast(id, message, options = {}) {
        return new Toast(id, { variant: 'success', message, ...options });
    }
    
    static createWarningToast(id, message, options = {}) {
        return new Toast(id, { variant: 'warning', message, ...options });
    }
    
    static createErrorToast(id, message, options = {}) {
        return new Toast(id, { variant: 'error', message, ...options });
    }
    
    static createInfoToast(id, message, options = {}) {
        return new Toast(id, { variant: 'info', message, ...options });
    }
    
    static createPrimaryToast(id, message, options = {}) {
        return new Toast(id, { variant: 'primary', message, ...options });
    }
    
    static createSecondaryToast(id, message, options = {}) {
        return new Toast(id, { variant: 'secondary', message, ...options });
    }
    
    static createNotificationToast(id, message, options = {}) {
        return new Toast(id, {
            variant: 'info',
            message,
            duration: 5000,
            dismissible: true,
            ...options
        });
    }
    
    static createAutoDismissToast(id, message, duration, options = {}) {
        return new Toast(id, { message, duration, ...options });
    }
    
    static createActionToast(id, message, action, options = {}) {
        return new Toast(id, { message, action, ...options });
    }
    
    static createProgressToast(id, message, options = {}) {
        return new Toast(id, {
            message,
            showProgress: true,
            duration: 10000,
            ...options
        });
    }
    
    static createTitledToast(id, title, message, options = {}) {
        return new Toast(id, { title, message, ...options });
    }
}
