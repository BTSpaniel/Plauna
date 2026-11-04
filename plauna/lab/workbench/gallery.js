// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Workbench lab widget gallery and the registry-backed widget demo modal.
 * Split out of lab/workbench-lab.js.
 */

import { createWidget, getWidget } from '../../widgets/index.js';
import { widgetStyleManager } from '../../widgets/WidgetStyleManager.js';
import { createDemoList, createDemoTable, createDemoTree } from './demos-data.js';
import { createDemoAlert, createDemoChip, createDemoEmptyState, createDemoSpinner, createDemoStatus, createDemoToast } from './demos-feedback.js';
import { createDemoCollapse, createDemoContainer, createDemoGrid, createDemoHeaderFooter, createDemoPanel, createDemoSection } from './demos-layout.js';
import { createDemoMenu, createDemoNavbar, createDemoSidebar, createDemoStepper } from './demos-navigation.js';
import { createDemoAvatar, createDemoBreadcrumb, createDemoCard, createDemoDropdown, createDemoLayout, createDemoModal, createDemoPagination, createDemoProgress, createDemoSkeleton } from './demos-primitive.js';

export function renderWidgetGallery(rootElement, toastManager) {
    const gallery = rootElement.querySelector('#widget-gallery');
    if (!gallery) return;
    gallery.innerHTML = `
        <div class="plauna-wgallery">
            <header class="plauna-wgallery__header">
                <span class="plauna-shell__badge">WIDGET LIBRARY</span>
            </header>
            <div class="plauna-wgallery__row">
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Buttons</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-toast="info" data-toast-msg="Primary button pressed">Primary</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-toast="info" data-toast-msg="Secondary button pressed">Secondary</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-toast="info" data-toast-msg="Ghost button pressed">Ghost</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" disabled>Disabled</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Badges</div>
                    <div class="plauna-wgallery__items">
                        <span class="plauna-demo-badge plauna-demo-badge--info">Info</span>
                        <span class="plauna-demo-badge plauna-demo-badge--success">Success</span>
                        <span class="plauna-demo-badge plauna-demo-badge--warning">Warning</span>
                        <span class="plauna-demo-badge plauna-demo-badge--error">Error</span>
                        <span class="plauna-demo-badge plauna-demo-badge--default">5</span>
                        <span class="plauna-demo-badge plauna-demo-badge--dot"></span>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Modal</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-modal="default">Open Modal</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-modal="warning">Warning Modal</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-modal="large">Large Modal</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Dropdown</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-dropdown="actions">Actions ▼</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-dropdown="options">Options ▼</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-dropdown="context">Context ▼</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Tooltips</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-tooltip="This is a helpful tooltip">Hover me</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-tooltip="Tooltip on top" data-tooltip-placement="top">Top</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-tooltip="Tooltip on right" data-tooltip-placement="right">Right</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Cards</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-card="product">Product Card</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-card="profile">Profile Card</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-card="elevated">Elevated Card</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Avatars</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-avatar="image">Image Avatar</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-avatar="initials">Initials</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-avatar="status">Status Avatar</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Breadcrumbs</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-breadcrumb="file">File Path</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-breadcrumb="site">Site Nav</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-breadcrumb="category">Category</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Pagination</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-pagination="standard">Standard</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-pagination="compact">Compact</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-pagination="jump">Jump to Page</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Progress</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-progress="linear">Linear</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-progress="circular">Circular</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-progress="indeterminate">Loading</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Skeletons</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-skeleton="text">Text</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-skeleton="avatar">Avatar</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-skeleton="paragraph">Paragraph</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Layout</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-layout="grid">Grid</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-layout="divider">Divider</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-layout="spacer">Spacer</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Input</div>
                    <div class="plauna-wgallery__items">
                        <input class="plauna-demo-input" type="text" placeholder="Type something…" />
                        <input class="plauna-demo-input" type="text" placeholder="Disabled" disabled />
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Form Controls</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-checkbox="default">Checkbox</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-radio="default">Radio</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-switch="default">Switch</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-select="default">Select</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-textarea="default">Textarea</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-slider="default">Slider</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-rating="default">Rating</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Data Display</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-table="default">Table</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-tree="default">Tree</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-list="default">List</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-chip="default">Chip</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Feedback & Status</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-alert="default">Alert</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-toast="default">Toast</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-spinner="default">Spinner</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-status="default">Status</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-emptystate="default">EmptyState</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Navigation & Layout</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-menu="default">Menu</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-navbar="default">Navbar</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-sidebar="default">Sidebar</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-stepper="default">Stepper</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-container="default">Container</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-section="default">Section</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-panel="default">Panel</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-collapse="default">Collapse</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-headerfooter="header">Header</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-headerfooter="footer">Footer</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-grid="default">Grid</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Input & Control</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-input="text">Input</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-button="default">Button</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-checkbox="default">Checkbox</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-radio="default">Radio</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-switch="default">Switch</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-select="default">Select</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-slider="default">Slider</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-progress="default">Progress</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-spinner="default">Spinner</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-file="default">File</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-color="default">Color</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-date="default">Date</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-time="default">Time</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-range="default">Range</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-rating="default">Rating</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-search="default">Search</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-number="default">Number</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-textarea="default">Textarea</button>
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-tag="default">Tag</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-upload="default">Upload</button>
                    </div>
                </div>
                <div class="plauna-wgallery__group">
                    <div class="plauna-wgallery__label">Toasts</div>
                    <div class="plauna-wgallery__items">
                        <button class="plauna-demo-btn plauna-demo-btn--primary" data-toast="success" data-toast-msg="Operation succeeded!">Success</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-toast="warning" data-toast-msg="Heads up — something changed">Warning</button>
                        <button class="plauna-demo-btn plauna-demo-btn--secondary" data-toast="error" data-toast-msg="Something went wrong">Error</button>
                        <button class="plauna-demo-btn plauna-demo-btn--ghost" data-toast="loading" data-toast-msg="Working…">Loading</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (toastManager) {
        gallery.addEventListener('click', (e) => {
            console.log('Gallery click event triggered:', e.target);
            
            const btn = e.target.closest('[data-toast]');
            if (btn) {
                toastManager.show(btn.dataset.toastMsg || 'Action fired', btn.dataset.toast);
                return;
            }
            
            // Handle modal buttons
            const modalBtn = e.target.closest('[data-modal]');
            if (modalBtn) {
                const modalType = modalBtn.dataset.modal;
                const modalId = `demo-modal-${modalType}`;
                let modal = document.getElementById(modalId);
                
                if (!modal) {
                    // Create modal dynamically
                    createDemoModal(modalType, modalId, toastManager);
                    modal = document.getElementById(modalId);
                }
                
                if (modal && modal.open) {
                    modal.open();
                }
                return;
            }
            
            // Handle dropdown buttons
            const dropdownBtn = e.target.closest('[data-dropdown]');
            if (dropdownBtn) {
                const dropdownType = dropdownBtn.dataset.dropdown;
                createDemoDropdown(dropdownType, dropdownBtn);
                return;
            }
            
            // Handle card buttons
            const cardBtn = e.target.closest('[data-card]');
            if (cardBtn) {
                console.log('Card button clicked:', cardBtn.dataset.card);
                e.stopPropagation(); // Prevent event from bubbling up
                try {
                    const cardType = cardBtn.dataset.card;
                    createDemoCard(cardType, cardBtn, toastManager);
                } catch (error) {
                    console.error('Card demo error:', error);
                    toastManager.show('Card demo error', 'error');
                }
                return;
            }
            
            // Handle avatar buttons
            const avatarBtn = e.target.closest('[data-avatar]');
            if (avatarBtn) {
                console.log('Avatar button clicked:', avatarBtn.dataset.avatar);
                e.stopPropagation(); // Prevent event from bubbling up
                try {
                    const avatarType = avatarBtn.dataset.avatar;
                    createDemoAvatar(avatarType, avatarBtn, toastManager);
                } catch (error) {
                    console.error('Avatar demo error:', error);
                    toastManager.show('Avatar demo error', 'error');
                }
                return;
            }
            
            // Handle breadcrumb buttons
            const breadcrumbBtn = e.target.closest('[data-breadcrumb]');
            if (breadcrumbBtn) {
                console.log('Breadcrumb button clicked:', breadcrumbBtn.dataset.breadcrumb);
                e.stopPropagation(); // Prevent event from bubbling up
                try {
                    const breadcrumbType = breadcrumbBtn.dataset.breadcrumb;
                    createDemoBreadcrumb(breadcrumbType, breadcrumbBtn, toastManager);
                } catch (error) {
                    console.error('Breadcrumb demo error:', error);
                    toastManager.show('Breadcrumb demo error', 'error');
                }
                return;
            }
            
            // Handle pagination buttons
            const paginationBtn = e.target.closest('[data-pagination]');
            if (paginationBtn) {
                console.log('Pagination button clicked:', paginationBtn.dataset.pagination);
                e.stopPropagation(); // Prevent event from bubbling up
                try {
                    const paginationType = paginationBtn.dataset.pagination;
                    createDemoPagination(paginationType, paginationBtn, toastManager);
                } catch (error) {
                    console.error('Pagination demo error:', error);
                    toastManager.show('Pagination demo error', 'error');
                }
                return;
            }
            
            // Handle progress buttons
            const progressBtn = e.target.closest('[data-progress]');
            if (progressBtn) {
                console.log('Progress button clicked:', progressBtn.dataset.progress);
                e.stopPropagation(); // Prevent event from bubbling up
                try {
                    const progressType = progressBtn.dataset.progress;
                    createDemoProgress(progressType, progressBtn, toastManager);
                } catch (error) {
                    console.error('Progress demo error:', error);
                    toastManager.show('Progress demo error', 'error');
                }
                return;
            }
            
            // Handle skeleton buttons
            const skeletonBtn = e.target.closest('[data-skeleton]');
            if (skeletonBtn) {
                console.log('Skeleton button clicked:', skeletonBtn.dataset.skeleton);
                e.stopPropagation(); // Prevent event from bubbling up
                try {
                    const skeletonType = skeletonBtn.dataset.skeleton;
                    createDemoSkeleton(skeletonType, skeletonBtn, toastManager);
                } catch (error) {
                    console.error('Skeleton demo error:', error);
                    toastManager.show('Skeleton demo error', 'error');
                }
                return;
            }
            
            // Handle layout buttons
            const layoutBtn = e.target.closest('[data-layout]');
            if (layoutBtn) {
                console.log('Layout button clicked:', layoutBtn.dataset.layout);
                e.stopPropagation(); // Prevent event from bubbling up
                try {
                    const layoutType = layoutBtn.dataset.layout;
                    createDemoLayout(layoutType, layoutBtn, toastManager);
                } catch (error) {
                    console.error('Layout demo error:', error);
                    toastManager.show('Layout demo error', 'error');
                }
                return;
            }
            
            // Handle form control buttons
            const checkboxBtn = e.target.closest('[data-checkbox]');
            if (checkboxBtn) {
                console.log('Checkbox button clicked:', checkboxBtn.dataset.checkbox);
                e.stopPropagation();
                try {
                    const checkboxType = checkboxBtn.dataset.checkbox;
                    createCheckboxWidget(checkboxType, checkboxBtn, toastManager);
                } catch (error) {
                    console.error('Checkbox widget error:', error);
                    toastManager.show('Checkbox widget error', 'error');
                }
                return;
            }
            
            const radioBtn = e.target.closest('[data-radio]');
            if (radioBtn) {
                console.log('Radio button clicked:', radioBtn.dataset.radio);
                e.stopPropagation();
                try {
                    const radioType = radioBtn.dataset.radio;
                    createRadioWidget(radioType, radioBtn, toastManager);
                } catch (error) {
                    console.error('Radio widget error:', error);
                    toastManager.show('Radio widget error', 'error');
                }
                return;
            }
            
            const switchBtn = e.target.closest('[data-switch]');
            if (switchBtn) {
                console.log('Switch button clicked:', switchBtn.dataset.switch);
                e.stopPropagation();
                try {
                    const switchType = switchBtn.dataset.switch;
                    createSwitchWidget(switchType, switchBtn, toastManager);
                } catch (error) {
                    console.error('Switch widget error:', error);
                    toastManager.show('Switch widget error', 'error');
                }
                return;
            }
            
            const selectBtn = e.target.closest('[data-select]');
            if (selectBtn) {
                console.log('Select button clicked:', selectBtn.dataset.select);
                e.stopPropagation();
                try {
                    const selectType = selectBtn.dataset.select;
                    createSelectWidget(selectType, selectBtn, toastManager);
                } catch (error) {
                    console.error('Select widget error:', error);
                    toastManager.show('Select widget error', 'error');
                }
                return;
            }
            
            const textareaBtn = e.target.closest('[data-textarea]');
            if (textareaBtn) {
                console.log('Textarea button clicked:', textareaBtn.dataset.textarea);
                e.stopPropagation();
                try {
                    const textareaType = textareaBtn.dataset.textarea;
                    createTextareaWidget(textareaType, textareaBtn, toastManager);
                } catch (error) {
                    console.error('Textarea widget error:', error);
                    toastManager.show('Textarea widget error', 'error');
                }
                return;
            }
            
            const sliderBtn = e.target.closest('[data-slider]');
            if (sliderBtn) {
                console.log('Slider button clicked:', sliderBtn.dataset.slider);
                e.stopPropagation();
                try {
                    const sliderType = sliderBtn.dataset.slider;
                    createSliderWidget(sliderType, sliderBtn, toastManager);
                } catch (error) {
                    console.error('Slider widget error:', error);
                    toastManager.show('Slider widget error', 'error');
                }
                return;
            }
            
            const ratingBtn = e.target.closest('[data-rating]');
            if (ratingBtn) {
                console.log('Rating button clicked:', ratingBtn.dataset.rating);
                e.stopPropagation();
                try {
                    const ratingType = ratingBtn.dataset.rating;
                    createRatingWidget(ratingType, ratingBtn, toastManager);
                } catch (error) {
                    console.error('Rating widget error:', error);
                    toastManager.show('Rating widget error', 'error');
                }
                return;
            }
            
            // Handle data display buttons
            const tableBtn = e.target.closest('[data-table]');
            if (tableBtn) {
                console.log('Table button clicked:', tableBtn.dataset.table);
                e.stopPropagation();
                try {
                    const tableType = tableBtn.dataset.table;
                    createDemoTable(tableType, tableBtn, toastManager);
                } catch (error) {
                    console.error('Table demo error:', error);
                    toastManager.show('Table demo error', 'error');
                }
                return;
            }
            
            const treeBtn = e.target.closest('[data-tree]');
            if (treeBtn) {
                console.log('Tree button clicked:', treeBtn.dataset.tree);
                e.stopPropagation();
                try {
                    const treeType = treeBtn.dataset.tree;
                    createDemoTree(treeType, treeBtn, toastManager);
                } catch (error) {
                    console.error('Tree demo error:', error);
                    toastManager.show('Tree demo error', 'error');
                }
                return;
            }
            
            const listBtn = e.target.closest('[data-list]');
            if (listBtn) {
                console.log('List button clicked:', listBtn.dataset.list);
                e.stopPropagation();
                try {
                    const listType = listBtn.dataset.list;
                    createDemoList(listType, listBtn, toastManager);
                } catch (error) {
                    console.error('List demo error:', error);
                    toastManager.show('List demo error', 'error');
                }
                return;
            }
            
            const chipBtn = e.target.closest('[data-chip]');
            if (chipBtn) {
                console.log('Chip button clicked:', chipBtn.dataset.chip);
                e.stopPropagation();
                try {
                    const chipType = chipBtn.dataset.chip;
                    createDemoChip(chipType, chipBtn, toastManager);
                } catch (error) {
                    console.error('Chip demo error:', error);
                    toastManager.show('Chip demo error', 'error');
                }
                return;
            }
            
            // Handle feedback buttons
            const alertBtn = e.target.closest('[data-alert]');
            if (alertBtn) {
                console.log('Alert button clicked:', alertBtn.dataset.alert);
                e.stopPropagation();
                try {
                    const alertType = alertBtn.dataset.alert;
                    createDemoAlert(alertType, alertBtn, toastManager);
                } catch (error) {
                    console.error('Alert demo error:', error);
                    toastManager.show('Alert demo error', 'error');
                }
                return;
            }
            
            const toastBtn = e.target.closest('[data-toast]');
            if (toastBtn) {
                console.log('Toast button clicked:', toastBtn.dataset.toast);
                e.stopPropagation();
                try {
                    const toastType = toastBtn.dataset.toast;
                    createDemoToast(toastType, toastBtn, toastManager);
                } catch (error) {
                    console.error('Toast demo error:', error);
                    toastManager.show('Toast demo error', 'error');
                }
                return;
            }
            
            const spinnerBtn = e.target.closest('[data-spinner]');
            if (spinnerBtn) {
                console.log('Spinner button clicked:', spinnerBtn.dataset.spinner);
                e.stopPropagation();
                try {
                    const spinnerType = spinnerBtn.dataset.spinner;
                    createDemoSpinner(spinnerType, spinnerBtn, toastManager);
                } catch (error) {
                    console.error('Spinner demo error:', error);
                    toastManager.show('Spinner demo error', 'error');
                }
                return;
            }
            
            const statusBtn = e.target.closest('[data-status]');
            if (statusBtn) {
                console.log('Status button clicked:', statusBtn.dataset.status);
                e.stopPropagation();
                try {
                    const statusType = statusBtn.dataset.status;
                    createDemoStatus(statusType, statusBtn, toastManager);
                } catch (error) {
                    console.error('Status demo error:', error);
                    toastManager.show('Status demo error', 'error');
                }
                return;
            }
            
            const emptystateBtn = e.target.closest('[data-emptystate]');
            if (emptystateBtn) {
                console.log('EmptyState button clicked:', emptystateBtn.dataset.emptystate);
                e.stopPropagation();
                try {
                    const emptystateType = emptystateBtn.dataset.emptystate;
                    createDemoEmptyState(emptystateType, emptystateBtn, toastManager);
                } catch (error) {
                    console.error('EmptyState demo error:', error);
                    toastManager.show('EmptyState demo error', 'error');
                }
                return;
            }
            
            // Handle navigation buttons
            const menuBtn = e.target.closest('[data-menu]');
            if (menuBtn) {
                console.log('Menu button clicked:', menuBtn.dataset.menu);
                e.stopPropagation();
                try {
                    const menuType = menuBtn.dataset.menu;
                    createDemoMenu(menuType, menuBtn, toastManager);
                } catch (error) {
                    console.error('Menu demo error:', error);
                    toastManager.show('Menu demo error', 'error');
                }
                return;
            }
            
            const navbarBtn = e.target.closest('[data-navbar]');
            if (navbarBtn) {
                console.log('Navbar button clicked:', navbarBtn.dataset.navbar);
                e.stopPropagation();
                try {
                    const navbarType = navbarBtn.dataset.navbar;
                    createDemoNavbar(navbarType, navbarBtn, toastManager);
                } catch (error) {
                    console.error('Navbar demo error:', error);
                    toastManager.show('Navbar demo error', 'error');
                }
                return;
            }
            
            const sidebarBtn = e.target.closest('[data-sidebar]');
            if (sidebarBtn) {
                console.log('Sidebar button clicked:', sidebarBtn.dataset.sidebar);
                e.stopPropagation();
                try {
                    const sidebarType = sidebarBtn.dataset.sidebar;
                    createDemoSidebar(sidebarType, sidebarBtn, toastManager);
                } catch (error) {
                    console.error('Sidebar demo error:', error);
                    toastManager.show('Sidebar demo error', 'error');
                }
                return;
            }
            
            // Handle stepper buttons
            const stepperBtn = e.target.closest('[data-stepper]');
            if (stepperBtn) {
                console.log('Stepper button clicked:', stepperBtn.dataset.stepper);
                e.stopPropagation();
                try {
                    const stepperType = stepperBtn.dataset.stepper;
                    createDemoStepper(stepperType, stepperBtn, toastManager);
                } catch (error) {
                    console.error('Stepper demo error:', error);
                    toastManager.show('Stepper demo error', 'error');
                }
                return;
            }
            
            // Handle container buttons
            const containerBtn = e.target.closest('[data-container]');
            if (containerBtn) {
                console.log('Container button clicked:', containerBtn.dataset.container);
                e.stopPropagation();
                try {
                    const containerType = containerBtn.dataset.container;
                    createDemoContainer(containerType, containerBtn, toastManager);
                } catch (error) {
                    console.error('Container demo error:', error);
                    toastManager.show('Container demo error', 'error');
                }
                return;
            }
            
            // Handle section buttons
            const sectionBtn = e.target.closest('[data-section]');
            if (sectionBtn) {
                console.log('Section button clicked:', sectionBtn.dataset.section);
                e.stopPropagation();
                try {
                    const sectionType = sectionBtn.dataset.section;
                    createDemoSection(sectionType, sectionBtn, toastManager);
                } catch (error) {
                    console.error('Section demo error:', error);
                    toastManager.show('Section demo error', 'error');
                }
                return;
            }
            
            // Handle panel buttons
            const panelBtn = e.target.closest('[data-panel]');
            if (panelBtn) {
                console.log('Panel button clicked:', panelBtn.dataset.panel);
                e.stopPropagation();
                try {
                    const panelType = panelBtn.dataset.panel;
                    createDemoPanel(panelType, panelBtn, toastManager);
                } catch (error) {
                    console.error('Panel demo error:', error);
                    toastManager.show('Panel demo error', 'error');
                }
                return;
            }
            
            // Handle collapse buttons
            const collapseBtn = e.target.closest('[data-collapse]');
            if (collapseBtn) {
                console.log('Collapse button clicked:', collapseBtn.dataset.collapse);
                e.stopPropagation();
                try {
                    const collapseType = collapseBtn.dataset.collapse;
                    createDemoCollapse(collapseType, collapseBtn, toastManager);
                } catch (error) {
                    console.error('Collapse demo error:', error);
                    toastManager.show('Collapse demo error', 'error');
                }
                return;
            }
            
            // Handle headerfooter buttons
            const headerFooterBtn = e.target.closest('[data-headerfooter]');
            if (headerFooterBtn) {
                console.log('HeaderFooter button clicked:', headerFooterBtn.dataset.headerfooter);
                e.stopPropagation();
                try {
                    const headerFooterType = headerFooterBtn.dataset.headerfooter;
                    createDemoHeaderFooter(headerFooterType, headerFooterBtn, toastManager);
                } catch (error) {
                    console.error('HeaderFooter demo error:', error);
                    toastManager.show('HeaderFooter demo error', 'error');
                }
                return;
            }
            
            // Handle grid buttons
            const gridBtn = e.target.closest('[data-grid]');
            if (gridBtn) {
                console.log('Grid button clicked:', gridBtn.dataset.grid);
                e.stopPropagation();
                try {
                    const gridType = gridBtn.dataset.grid;
                    createDemoGrid(gridType, gridBtn, toastManager);
                } catch (error) {
                    console.error('Grid demo error:', error);
                    toastManager.show('Grid demo error', 'error');
                }
                return;
            }
            
            // Handle input buttons
            const inputBtn = e.target.closest('[data-input]');
            if (inputBtn) {
                console.log('Input button clicked:', inputBtn.dataset.input);
                e.stopPropagation();
                try {
                    const inputType = inputBtn.dataset.input;
                    createInputWidget(inputType, inputBtn, toastManager);
                } catch (error) {
                    console.error('Input widget error:', error);
                    toastManager.show('Input widget error', 'error');
                }
                return;
            }
            
            // Handle button buttons
            const buttonBtn = e.target.closest('[data-button]');
            if (buttonBtn) {
                console.log('Button button clicked:', buttonBtn.dataset.button);
                e.stopPropagation();
                try {
                    const buttonType = buttonBtn.dataset.button;
                    createButtonWidget(buttonType, buttonBtn, toastManager);
                } catch (error) {
                    console.error('Button widget error:', error);
                    toastManager.show('Button widget error', 'error');
                }
                return;
            }
            
            // Handle file buttons
            const fileBtn = e.target.closest('[data-file]');
            if (fileBtn) {
                console.log('File button clicked:', fileBtn.dataset.file);
                e.stopPropagation();
                try {
                    const fileType = fileBtn.dataset.file;
                    createFileWidget(fileType, fileBtn, toastManager);
                } catch (error) {
                    console.error('File widget error:', error);
                    toastManager.show('File widget error', 'error');
                }
                return;
            }
            
            // Handle color buttons
            const colorBtn = e.target.closest('[data-color]');
            if (colorBtn) {
                console.log('Color button clicked:', colorBtn.dataset.color);
                e.stopPropagation();
                try {
                    const colorType = colorBtn.dataset.color;
                    createColorWidget(colorType, colorBtn, toastManager);
                } catch (error) {
                    console.error('Color widget error:', error);
                    toastManager.show('Color widget error', 'error');
                }
                return;
            }
            
            // Handle date buttons
            const dateBtn = e.target.closest('[data-date]');
            if (dateBtn) {
                console.log('Date button clicked:', dateBtn.dataset.date);
                e.stopPropagation();
                try {
                    const dateType = dateBtn.dataset.date;
                    createDateWidget(dateType, dateBtn, toastManager);
                } catch (error) {
                    console.error('Date widget error:', error);
                    toastManager.show('Date widget error', 'error');
                }
                return;
            }
            
            // Handle time buttons
            const timeBtn = e.target.closest('[data-time]');
            if (timeBtn) {
                console.log('Time button clicked:', timeBtn.dataset.time);
                e.stopPropagation();
                try {
                    const timeType = timeBtn.dataset.time;
                    createTimeWidget(timeType, timeBtn, toastManager);
                } catch (error) {
                    console.error('Time widget error:', error);
                    toastManager.show('Time widget error', 'error');
                }
                return;
            }
            
            // Handle range buttons
            const rangeBtn = e.target.closest('[data-range]');
            if (rangeBtn) {
                console.log('Range button clicked:', rangeBtn.dataset.range);
                e.stopPropagation();
                try {
                    const rangeType = rangeBtn.dataset.range;
                    createRangeWidget(rangeType, rangeBtn, toastManager);
                } catch (error) {
                    console.error('Range widget error:', error);
                    toastManager.show('Range widget error', 'error');
                }
                return;
            }
            
            // Handle search buttons
            const searchBtn = e.target.closest('[data-search]');
            if (searchBtn) {
                console.log('Search button clicked:', searchBtn.dataset.search);
                e.stopPropagation();
                try {
                    const searchType = searchBtn.dataset.search;
                    createSearchWidget(searchType, searchBtn, toastManager);
                } catch (error) {
                    console.error('Search widget error:', error);
                    toastManager.show('Search widget error', 'error');
                }
                return;
            }
            
            // Handle number buttons
            const numberBtn = e.target.closest('[data-number]');
            if (numberBtn) {
                console.log('Number button clicked:', numberBtn.dataset.number);
                e.stopPropagation();
                try {
                    const numberType = numberBtn.dataset.number;
                    createNumberWidget(numberType, numberBtn, toastManager);
                } catch (error) {
                    console.error('Number widget error:', error);
                    toastManager.show('Number widget error', 'error');
                }
                return;
            }
            
            // Handle tag buttons
            const tagBtn = e.target.closest('[data-tag]');
            if (tagBtn) {
                console.log('Tag button clicked:', tagBtn.dataset.tag);
                e.stopPropagation();
                try {
                    const tagType = tagBtn.dataset.tag;
                    createTagWidget(tagType, tagBtn, toastManager);
                } catch (error) {
                    console.error('Tag widget error:', error);
                    toastManager.show('Tag widget error', 'error');
                }
                return;
            }
            
            // Handle upload buttons
            const uploadBtn = e.target.closest('[data-upload]');
            if (uploadBtn) {
                console.log('Upload button clicked:', uploadBtn.dataset.upload);
                e.stopPropagation();
                try {
                    const uploadType = uploadBtn.dataset.upload;
                    createUploadWidget(uploadType, uploadBtn, toastManager);
                } catch (error) {
                    console.error('Upload widget error:', error);
                    toastManager.show('Upload widget error', 'error');
                }
                return;
            }
        });
        
        // Handle tooltips
        gallery.addEventListener('mouseover', (e) => {
            const tooltipBtn = e.target.closest('[data-tooltip]');
            if (tooltipBtn && !tooltipBtn._tooltip) {
                const tooltipText = tooltipBtn.dataset.tooltip;
                const placement = tooltipBtn.dataset.tooltipPlacement || 'top';
                
                // Create tooltip using theme-based styling
                const tooltipStyles = widgetStyleManager.getWidgetStyles('tooltip');
                const tooltipElement = widgetStyleManager.createStyledElement('div', tooltipStyles.container, 'plauna-demo-tooltip');
                tooltipElement.textContent = tooltipText;
                
                document.body.appendChild(tooltipElement);
                
                // Position tooltip
                const rect = tooltipBtn.getBoundingClientRect();
                const tooltipRect = tooltipElement.getBoundingClientRect();
                
                let top = rect.top - tooltipRect.height - 8;
                let left = rect.left + (rect.width - tooltipRect.width) / 2;
                
                // Adjust if tooltip would go outside viewport
                if (top < 10) {
                    top = rect.bottom + 8;
                }
                if (left < 10) {
                    left = 10;
                } else if (left + tooltipRect.width > window.innerWidth - 10) {
                    left = window.innerWidth - tooltipRect.width - 10;
                }
                
                tooltipElement.style.top = `${top + window.pageYOffset}px`;
                tooltipElement.style.left = `${left + window.pageXOffset}px`;
                
                // Animate in using theme styles
                requestAnimationFrame(() => {
                    widgetStyleManager.applyStyles(tooltipElement, tooltipStyles.visible);
                });
                
                tooltipBtn._tooltip = tooltipElement;
            }
        });
        
        gallery.addEventListener('mouseout', (e) => {
            const tooltipBtn = e.target.closest('[data-tooltip]');
            if (tooltipBtn && tooltipBtn._tooltip) {
                const tooltipElement = tooltipBtn._tooltip;
                
                // Animate out using theme styles
                const tooltipStyles = widgetStyleManager.getWidgetStyles('tooltip');
                widgetStyleManager.applyStyles(tooltipElement, { 
                    opacity: '0',
                    transform: 'scale(0.8)'
                });
                
                setTimeout(() => {
                    if (tooltipElement.parentNode) {
                        tooltipElement.parentNode.removeChild(tooltipElement);
                    }
                }, 150);
                
                tooltipBtn._tooltip = null;
            }
        });
    }
}

function showWidgetDemo(widgetType, toastManager) {
    // Get widget class for metadata
    const widgetClass = getWidget(widgetType);
    const displayName = widgetClass ? widgetClass.name : widgetType.charAt(0).toUpperCase() + widgetType.slice(1);
    const description = widgetClass ? widgetClass.description : `Interactive ${widgetType} widget`;
    
    // Get modal styles from theme manager
    const modalStyles = widgetStyleManager.getWidgetStyles('modal', 'md');
    
    // Create modal container using theme styles
    const modalElement = widgetStyleManager.createStyledElement('div', modalStyles.container, 'plauna-widget-modal');
    
    // Create modal panel
    const modalPanel = widgetStyleManager.createStyledElement('div', modalStyles.panel);
    
    // Create header
    const header = widgetStyleManager.createStyledElement('header', modalStyles.header);
    
    // Create title
    const title = widgetStyleManager.createStyledElement('h2', modalStyles.title);
    title.textContent = `${displayName} Widget`;
    
    // Create description
    const descriptionElement = document.createElement('p');
    descriptionElement.textContent = description;
    descriptionElement.style.cssText = `
        margin: 0 0 24px 0;
        color: #a1a1aa;
        font-size: 14px;
    `;
    
    // Create close button
    const closeButton = widgetStyleManager.createStyledElement('button', modalStyles.closeButton);
    closeButton.innerHTML = '×';
    
    // Create widget container
    const widgetContainerStyles = widgetStyleManager.getWidgetStyles('widget-container');
    const widgetContainer = widgetStyleManager.createStyledElement('div', widgetContainerStyles.container, `${widgetType}-widget-container`);
    
    // Setup close button interactions
    closeButton.addEventListener('mouseenter', () => {
        widgetStyleManager.applyStyles(closeButton, modalStyles.closeButtonHover);
    });
    
    closeButton.addEventListener('mouseleave', () => {
        widgetStyleManager.applyStyles(closeButton, modalStyles.closeButton);
    });
    
    closeButton.addEventListener('click', () => {
        closeModal();
    });
    
    // Assemble modal
    header.appendChild(title);
    header.appendChild(descriptionElement);
    header.appendChild(closeButton);
    modalPanel.appendChild(header);
    modalPanel.appendChild(widgetContainer);
    modalElement.appendChild(modalPanel);
    
    // Add to DOM
    document.body.appendChild(modalElement);
    
    // Modal functions
    function openModal() {
        widgetStyleManager.applyStyles(modalElement, { opacity: '1' });
        widgetStyleManager.applyStyles(modalPanel, { transform: 'scale(1)' });
    }
    
    function closeModal() {
        widgetStyleManager.applyStyles(modalElement, { opacity: '0' });
        widgetStyleManager.applyStyles(modalPanel, { transform: 'scale(0.95)' });
        setTimeout(() => {
            if (modalElement.parentNode) {
                modalElement.parentNode.removeChild(modalElement);
            }
        }, 200);
    }
    
    // Close on background click
    modalElement.addEventListener('click', (e) => {
        if (e.target === modalElement) {
            closeModal();
        }
    });
    
    // Create widget instance using modular system
    try {
        const widgetOptions = getWidgetOptions(widgetType, toastManager);
        const widget = createWidget(widgetType, widgetContainer, widgetOptions);
        
        if (widget) {
            console.log(`Real Plauna ${widgetType} widget initialized`);
            toastManager.show(`${displayName} widget loaded`, 'success');
        } else {
            throw new Error(`Failed to create ${widgetType} widget`);
        }
        
    } catch (error) {
        console.error(`Error initializing ${widgetType} widget:`, error);
        widgetContainer.innerHTML = `
            <div style="color: #ef4444; padding: 16px; border: 1px solid #ef4444; border-radius: 4px; background: rgba(239, 68, 68, 0.1);">
                Error loading ${displayName} widget: ${error.message}
            </div>
        `;
        toastManager.show(`Error loading ${displayName} widget`, 'error');
    }
    
    // Open modal
    openModal();
}

// Widgets generate their own options automatically using modular system
function getWidgetOptions(widgetType, toastManager) {
    const baseOptions = {
        onChange: (value) => console.log(`${widgetType} changed:`, value),
        onFocus: () => toastManager.show(`${widgetType} focused`, 'info', 1000),
        onBlur: () => toastManager.show(`${widgetType} blurred`, 'info', 1000)
    };
    
    // Get widget class to use its default options
    const widgetClass = getWidget(widgetType);
    const widgetDefaultOptions = widgetClass ? widgetClass.getDefaultOptions() : {};
    
    // Widget-specific options (override defaults)
    const widgetOptions = {
        search: {
            placeholder: 'Search Plauna widgets...',
            suggestions: ['Search', 'Input', 'Button', 'Checkbox', 'Radio', 'Select', 'Textarea', 'Slider', 'Rating', 'Number', 'Time', 'File', 'Color', 'Date', 'Range', 'Tag', 'Upload'],
            onSearch: (query) => toastManager.show(`Searching: ${query}`, 'success'),
            onSelect: (suggestion) => toastManager.show(`Selected: ${suggestion}`, 'success')
        },
        'input-field': {
            placeholder: 'Type something...',
            maxLength: 100,
            onChange: (value) => {
                if (value.length > 0) toastManager.show(`Text: ${value}`, 'info');
            }
        },
        button: {
            label: 'Click me!',
            onClick: () => toastManager.show('Button clicked!', 'success')
        },
        number: {
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange: (value) => toastManager.show(`Value: ${value}`, 'info'),
            onIncrement: (value) => toastManager.show(`Increased: ${value}`, 'success'),
            onDecrement: (value) => toastManager.show(`Decreased: ${value}`, 'warning')
        },
        tag: {
            placeholder: 'Add tags...',
            suggestions: ['javascript', 'plauna', 'widgets', 'ui', 'framework'],
            onChange: (tags) => toastManager.show(`Tags: ${tags.join(', ')}`, 'info')
        },
        upload: {
            accept: 'image/*,.pdf,.doc,.docx',
            multiple: true,
            maxSize: 5 * 1024 * 1024,
            onChange: (files) => {
                const fileNames = Array.from(files).map(f => f.name).join(', ');
                toastManager.show(`Files: ${fileNames}`, 'info');
            },
            onUpload: (files) => toastManager.show(`Uploaded ${files.length} files`, 'success')
        },
        checkbox: {
            label: 'Accept terms and conditions',
            checked: false,
            onChange: (checked) => toastManager.show(`Checkbox ${checked ? 'checked' : 'unchecked'}`, 'info')
        },
        radio: {
            label: 'Choose option',
            options: ['Option 1', 'Option 2', 'Option 3'],
            selected: 0,
            onChange: (index) => toastManager.show(`Radio option ${index + 1} selected`, 'info')
        },
        switch: {
            label: 'Enable notifications',
            checked: true,
            onChange: (checked) => toastManager.show(`Switch ${checked ? 'on' : 'off'}`, 'info')
        },
        select: {
            placeholder: 'Choose an option...',
            options: ['First option', 'Second option', 'Third option'],
            onChange: (value) => toastManager.show(`Selected: ${value}`, 'info')
        },
        textarea: {
            placeholder: 'Enter your message here...',
            rows: 4,
            maxLength: 500,
            onChange: (value) => toastManager.show(`Text length: ${value.length}`, 'info')
        },
        rating: {
            max: 5,
            value: 3,
            onChange: (rating) => toastManager.show(`Rating: ${rating} stars`, 'info')
        },
        color: {
            value: '#3b82f6',
            onChange: (color) => toastManager.show(`Color: ${color}`, 'info')
        },
        date: {
            value: new Date().toISOString().split('T')[0],
            onChange: (date) => toastManager.show(`Date: ${date}`, 'info')
        },
        time: {
            value: '12:00',
            onChange: (time) => toastManager.show(`Time: ${time}`, 'info')
        },
        range: {
            min: 0,
            max: 100,
            value: [25, 75],
            onChange: (values) => toastManager.show(`Range: ${values[0]} - ${values[1]}`, 'info')
        },
        file: {
            accept: '*',
            multiple: false,
            onChange: (files) => {
                const fileName = files[0]?.name || 'No file selected';
                toastManager.show(`File: ${fileName}`, 'info');
            }
        }
    };
    
    // Merge options in priority order: base -> widget defaults -> specific overrides
    return { 
        ...baseOptions, 
        ...widgetDefaultOptions, 
        ...(widgetOptions[widgetType] || {}) 
    };
}

function createSearchWidget(type, triggerButton, toastManager) {
    // Plauna philosophy: 1 line of code to show any widget
    showWidgetDemo('search', toastManager);
}

function createTagWidget(type, triggerButton, toastManager) {
    // Plauna philosophy: 1 line of code to show any widget
    showWidgetDemo('tag', toastManager);
}

function createUploadWidget(type, triggerButton, toastManager) {
    // Plauna philosophy: 1 line of code to show any widget
    showWidgetDemo('upload', toastManager);
}

function createNumberWidget(type, triggerButton, toastManager) {
    // Plauna philosophy: 1 line of code to show any widget
    showWidgetDemo('number', toastManager);
}

function createInputWidget(type, triggerButton, toastManager) {
    // Plauna philosophy: 1 line of code to show any widget
    showWidgetDemo('input-field', toastManager);
}

function createButtonWidget(type, triggerButton, toastManager) {
    // Plauna philosophy: 1 line of code to show any widget
    showWidgetDemo('button', toastManager);
}

// Remaining widget functions following Plauna philosophy
function createCheckboxWidget(type, triggerButton, toastManager) {
    showWidgetDemo('checkbox', toastManager);
}

function createRadioWidget(type, triggerButton, toastManager) {
    showWidgetDemo('radio', toastManager);
}

function createSwitchWidget(type, triggerButton, toastManager) {
    showWidgetDemo('switch', toastManager);
}

function createSelectWidget(type, triggerButton, toastManager) {
    showWidgetDemo('select', toastManager);
}

function createTextareaWidget(type, triggerButton, toastManager) {
    showWidgetDemo('textarea', toastManager);
}

function createSliderWidget(type, triggerButton, toastManager) {
    // Plauna has one slider widget: Range
    showWidgetDemo('range', toastManager);
}

function createRatingWidget(type, triggerButton, toastManager) {
    showWidgetDemo('rating', toastManager);
}

function createColorWidget(type, triggerButton, toastManager) {
    showWidgetDemo('color', toastManager);
}

function createDateWidget(type, triggerButton, toastManager) {
    showWidgetDemo('date', toastManager);
}

function createTimeWidget(type, triggerButton, toastManager) {
    showWidgetDemo('time', toastManager);
}

function createRangeWidget(type, triggerButton, toastManager) {
    showWidgetDemo('range', toastManager);
}

function createFileWidget(type, triggerButton, toastManager) {
    showWidgetDemo('file', toastManager);
}
