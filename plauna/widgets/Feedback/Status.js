// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Status - Status indicator widget for Plauna
 * Provides status functionality with multiple variants and sizes
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf } from '../shared/appearance.js';

// The tone of each status; offline and default show the secondary text colour
const STATUS_TONES = {
    online: 'success', busy: 'warning', away: 'info', success: 'success',
    warning: 'warning', error: 'danger', info: 'info', processing: 'primary'
};

let _statusSequence = 0;

function _newStatusId() {
    return `status-${Date.now()}-${++_statusSequence}`;
}

export class Status extends UINode {
    // Widget metadata
    static id = 'status';
    static name = 'Status';
    static category = 'feedback';
    static icon = '🔴';
    static description = 'Status indicator';
    static tags = ['feedback', 'status', 'indicator'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            status: 'idle',
            message: '',
            showIcon: true
        };
    }
    
    static create(container, options = {}) {
        const instance = new Status(_newStatusId(), options);
        if (container && container instanceof HTMLElement) {
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    static stories() {
        return {
            'Online': { status: 'online', label: 'Connected' },
            'Busy': { status: 'busy', label: 'Compiling' },
            'Offline': { status: 'offline', label: 'Disconnected' }
        };
    }
    
    constructor(id = _newStatusId(), options = {}) {
        super(id, 'status');
        
        // Status-specific properties
        this.status = options.status || 'default'; // default, online, offline, busy, away, success, warning, error, info, processing
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.label = options.label || '';
        this.description = options.description || '';
        this.showIcon = options.showIcon ?? (options.icon !== false);
        this.showLabel = options.showLabel !== false;
        this.showDescription = options.showDescription || false;
        this.icon = typeof options.icon === 'string' && options.icon ? options.icon : null;
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error, info
        this.pulse = options.pulse || false;
        this.dot = options.dot || false;
        
        // Set accessibility
        this.role = 'status';
        this.ariaLive = 'polite';
        this.ariaAtomic = 'true';
        this.ariaLabel = this.label || options.ariaLabel || this.getStatusText();
        
        // Set default styles
        this.setupStyles();
        
        // Build status structure
        this.buildStatus();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'inline-flex',
            alignItems: 'center',
            gap: tokens.css('spacing.sm'),
            color: this.getTextColor(),
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
                iconSize: '12px'
            },
            sm: {
                fontSize: tokens.css('fontSizes.sm'),
                iconSize: '14px'
            },
            md: {
                fontSize: tokens.css('fontSizes.md'),
                iconSize: '16px'
            },
            lg: {
                fontSize: tokens.css('fontSizes.lg'),
                iconSize: '20px'
            },
            xl: {
                fontSize: tokens.css('fontSizes.xl'),
                iconSize: '24px'
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        return { color: this.toneColors()?.text ?? tokens.css('colors.text.secondary') };
    }

    /** The tone to show: a named variant wins over the status; offline and default have none. */
    toneColors() {
        if (this.variant && this.variant !== 'default') return toneOf(this.variant);
        return STATUS_TONES[this.status] ? toneOf(STATUS_TONES[this.status]) : null;
    }
    
    getTextColor() {
        // Priority: variant > status > default
        return this.toneColors()?.text ?? tokens.css('colors.text.secondary');
    }
    
    getIconColor() {
        // Priority: variant > status > default
        return this.toneColors()?.base ?? tokens.css('colors.text.secondary');
    }
    
    getDotColor() {
        const name = STATUS_TONES[this.status];
        return name ? toneOf(name).base : tokens.css('colors.text.secondary');
    }
    
    buildStatus() {
        this.clearChildren();
        
        // Create status dot if enabled
        if (this.dot) {
            const dot = this.createStatusDot();
            this.appendElement(dot);
        }
        
        // Create icon if enabled
        if (this.showIcon) {
            const icon = this.createIcon();
            this.appendElement(icon);
        }
        
        // Create text container
        const textContainer = document.createElement('div');
        textContainer.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.css('spacing.xs') + ';'
        );
        
        // Add label if enabled
        if (this.showLabel && this.label) {
            const labelElement = document.createElement('div');
            labelElement.textContent = this.label;
            labelElement.style.cssText = (
                'font-weight: ' + tokens.css('fontWeights.semibold') + ';' +
                'color: inherit;' +
                'line-height: 1.2;'
            );
            textContainer.appendChild(labelElement);
        }
        
        // Add description if enabled
        if (this.showDescription && this.description) {
            const descriptionElement = document.createElement('div');
            descriptionElement.textContent = this.description;
            descriptionElement.style.cssText = (
                'font-size: ' + tokens.css('fontSizes.sm') + ';' +
                'color: ' + tokens.css('colors.text.secondary') + ';' +
                'line-height: 1.3;' +
                'opacity: 0.8;'
            );
            textContainer.appendChild(descriptionElement);
        }
        
        // Add text container if it has content
        if (textContainer.children.length > 0) {
            this.appendElement(textContainer);
        }
        
        // Add pulse animation if enabled
        if (this.pulse) {
            this.style.animation = 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite';
            this.addPulseKeyframes();
        }
    }
    
    createStatusDot() {
        const dot = document.createElement('div');
        dot.style.cssText = (
            'width: 8px;' +
            'height: 8px;' +
            'background: ' + this.getDotColor() + ';' +
            'border-radius: 50%;' +
            'flex-shrink: 0;' +
            'margin-right: ' + tokens.css('spacing.sm') + ';'
        );
        
        // Add pulse animation to dot if status is specific
        if (['online', 'processing', 'busy'].includes(this.status)) {
            dot.style.animation = 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite';
            this.addPulseKeyframes();
        }
        
        return dot;
    }
    
    createIcon() {
        const icon = document.createElement('span');
        icon.style.cssText = (
            'width: ' + this.getSizeStyles().iconSize + ';' +
            'height: ' + this.getSizeStyles().iconSize + ';' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'font-size: ' + this.getSizeStyles().iconSize + ';' +
            'color: ' + this.getIconColor() + ';' +
            'flex-shrink: 0;'
        );
        
        // Get icon based on status if no custom icon is provided
        const iconText = this.icon || this.getDefaultIcon();
        icon.textContent = iconText;
        
        return icon;
    }
    
    getDefaultIcon() {
        const statusIcons = {
            default: '⚪',
            online: '🟢',
            offline: '⚫',
            busy: '⏳',
            away: '🚶',
            success: '✅',
            warning: '⚠️',
            error: '❌',
            info: 'ℹ️',
            processing: '⚙️'
        };
        return statusIcons[this.status] || statusIcons.default;
    }
    
    getStatusText() {
        const statusTexts = {
            default: 'Status',
            online: 'Online',
            offline: 'Offline',
            busy: 'Busy',
            away: 'Away',
            success: 'Success',
            warning: 'Warning',
            error: 'Error',
            info: 'Info',
            processing: 'Processing'
        };
        return statusTexts[this.status] || statusTexts.default;
    }
    
    addPulseKeyframes() {
        if (!document.querySelector('#plauna-pulse-keyframes')) {
            const style = document.createElement('style');
            style.id = 'plauna-pulse-keyframes';
            style.textContent = `
                @keyframes pulse {
                    0%, 100% {
                        opacity: 1;
                    }
                    50% {
                        opacity: 0.5;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    // Public methods
    setStatus(status) {
        if (this.status !== status) {
            this.status = status;
            this.ariaLabel = this.label || this.getStatusText();
            this.buildStatus();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildStatus();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildStatus();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setLabel(label) {
        if (this.label !== label) {
            this.label = label;
            this.ariaLabel = label || this.getStatusText();
            this.buildStatus();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setDescription(description) {
        if (this.description !== description) {
            this.description = description;
            this.buildStatus();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowIcon(showIcon) {
        if (this.showIcon !== showIcon) {
            this.showIcon = showIcon;
            this.buildStatus();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowLabel(showLabel) {
        if (this.showLabel !== showLabel) {
            this.showLabel = showLabel;
            this.buildStatus();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowDescription(showDescription) {
        if (this.showDescription !== showDescription) {
            this.showDescription = showDescription;
            this.buildStatus();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setIcon(icon) {
        if (this.icon !== icon) {
            this.icon = icon;
            this.buildStatus();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setPulse(pulse) {
        if (this.pulse !== pulse) {
            this.pulse = pulse;
            if (pulse) {
                this.style.animation = 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite';
                this.addPulseKeyframes();
            } else {
                this.style.animation = '';
            }
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }
    
    setDot(dot) {
        if (this.dot !== dot) {
            this.dot = dot;
            this.buildStatus();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    // Static factory methods
    static createStatus(id, options = {}) {
        return new Status(id, options);
    }
    
    static createOnlineStatus(id, options = {}) {
        return new Status(id, { status: 'online', ...options });
    }
    
    static createOfflineStatus(id, options = {}) {
        return new Status(id, { status: 'offline', ...options });
    }
    
    static createBusyStatus(id, options = {}) {
        return new Status(id, { status: 'busy', ...options });
    }
    
    static createAwayStatus(id, options = {}) {
        return new Status(id, { status: 'away', ...options });
    }
    
    static createSuccessStatus(id, options = {}) {
        return new Status(id, { status: 'success', ...options });
    }
    
    static createWarningStatus(id, options = {}) {
        return new Status(id, { status: 'warning', ...options });
    }
    
    static createErrorStatus(id, options = {}) {
        return new Status(id, { status: 'error', ...options });
    }
    
    static createInfoStatus(id, options = {}) {
        return new Status(id, { status: 'info', ...options });
    }
    
    static createProcessingStatus(id, options = {}) {
        return new Status(id, { status: 'processing', ...options });
    }
    
    static createPrimaryStatus(id, options = {}) {
        return new Status(id, { variant: 'primary', ...options });
    }
    
    static createSecondaryStatus(id, options = {}) {
        return new Status(id, { variant: 'secondary', ...options });
    }
    
    static createSmallStatus(id, options = {}) {
        return new Status(id, { size: 'sm', ...options });
    }
    
    static createLargeStatus(id, options = {}) {
        return new Status(id, { size: 'lg', ...options });
    }
    
    static createXLargeStatus(id, options = {}) {
        return new Status(id, { size: 'xl', ...options });
    }
    
    static createDotStatus(id, options = {}) {
        return new Status(id, { dot: true, ...options });
    }
    
    static createPulsingStatus(id, options = {}) {
        return new Status(id, { pulse: true, ...options });
    }
    
    static createLabeledStatus(id, label, options = {}) {
        return new Status(id, { label, showLabel: true, ...options });
    }
    
    static createDescribedStatus(id, label, description, options = {}) {
        return new Status(id, { label, description, showLabel: true, showDescription: true, ...options });
    }
    
    static createIconStatus(id, icon, options = {}) {
        return new Status(id, { icon, showIcon: true, ...options });
    }
    
    static createConnectionStatus(id, options = {}) {
        return new Status(id, { 
            status: 'online', 
            dot: true,
            pulse: true,
            ...options 
        });
    }
    
    static createTaskStatus(id, options = {}) {
        return new Status(id, {
            status: 'processing',
            pulse: true,
            ...options
        });
    }
    
    static createUserStatus(id, options = {}) {
        return new Status(id, {
            status: 'away',
            showIcon: true,
            ...options
        });
    }
}
