( function ( M, $ ) {

	var
		// see: https://www.mediawiki.org/wiki/Manual:Interface/JavaScript#Page-specific
		isReadOnly = mw.config.get( 'wgMinervaReadOnly' ),
		isEditable = !isReadOnly && mw.config.get( 'wgIsProbablyEditable' ),
		blockInfo = mw.config.get( 'wgMinervaUserBlockInfo', false ),
		router = require( 'mediawiki.router' ),
		issues = M.require( 'skins.minerva.scripts/pageIssues' ),
		overlayManager = M.require( 'skins.minerva.scripts/overlayManager' ),
		loader = M.require( 'mobile.startup/rlModuleLoader' ),
		Icon = M.require( 'mobile.startup/Icon' ),
		Button = M.require( 'mobile.startup/Button' ),
		Anchor = M.require( 'mobile.startup/Anchor' ),
		skin = M.require( 'skins.minerva.scripts/skin' ),
		currentPage = M.getCurrentPage(),
		// TODO: create a utility method to generate class names instead of
		//       constructing temporary objects. This affects disabledEditIcon,
		//       enabledEditIcon, enabledEditIcon, and disabledClass and
		//       a number of other places in the code base.
		disabledEditIcon = new Icon( {
			name: 'edit',
			glyphPrefix: 'minerva'
		} ),
		enabledEditIcon = new Icon( {
			name: 'edit-enabled',
			glyphPrefix: 'minerva'
		} ),
		editErrorMessage = isReadOnly ? mw.msg( 'apierror-readonly' ) : mw.msg( 'mobile-frontend-editor-disabled' ),
		// TODO: move enabledClass, $caEdit, and disabledClass to locals within
		//       updateEditPageButton().
		enabledClass = enabledEditIcon.getGlyphClassName(),
		disabledClass = disabledEditIcon.getGlyphClassName(),
		// TODO: rename to editPageButton.
		$caEdit = $( '#ca-edit' ),
		user = M.require( 'mobile.startup/user' ),
		popup = M.require( 'mobile.startup/toast' ),
		// FIXME: Disable on IE < 10 for time being
		blacklisted = /MSIE \d\./.test( navigator.userAgent ),
		contentModel = mw.config.get( 'wgPageContentModel' ),
		isEditingSupported = router.isSupported() && !blacklisted,
		// FIXME: Use currentPage.getId()
		isNewPage = currentPage.options.id === 0,
		isNewFile = currentPage.inNamespace( 'file' ) && isNewPage,
		veConfig = mw.config.get( 'wgVisualEditorConfig' ),
		// FIXME: Should we consider default site options and user prefs?
		isVisualEditorEnabled = veConfig,
		CtaDrawer = M.require( 'mobile.startup/CtaDrawer' ),
		drawer;

	if ( user.isAnon() ) {
		blockInfo = false;
	}

	/**
	 * Event handler for edit link clicks. Will prevent default link
	 * behaviour and will not allow propagation
	 * @method
	 * @ignore
	 * @return {boolean}
	 */
	function onEditLinkClick() {
		issues.log( { action: 'editClicked' } );

		router.navigate( '#/editor/' + $( this ).data( 'section' ) );
		// prevent folding section when clicking Edit by stopping propagation
		return false;
	}

	// TODO: rename addEditSectionButton and evaluate whether the page edit button
	//       can leverage the same code. Also: change the CSS class name to use
	//       the word "section" instead of "page".
	/**
	 * Prepend an edit page button to the container
	 * Remove any existing links in the container
	 * @method
	 * @ignore
	 * @param {number} section number
	 * @param {string} container CSS selector of the container
	 * @return {JQuery.Object} newly created edit page button
	 */
	function addEditButton( section, container ) {
		$( container ).find( 'a' ).remove();
		return $( '<a class="edit-page">' )
			.data( 'section', section )
			.on( 'click', onEditLinkClick )
			.text( mw.msg( 'mobile-frontend-editor-edit' ) )
			.prependTo( container );
	}

	/**
	 * @param {boolean} enabled
	 * @return {void}
	 */
	function updateEditPageButton( enabled ) {
		$caEdit
			.addClass( enabled ? enabledClass : disabledClass )
			.removeClass( enabled ? disabledClass : enabledClass )
			// TODO: can hidden be removed from the default state?
			.removeClass( 'hidden' );
	}

	/**
	 * Make an element render a CTA when clicked
	 * @method
	 * @ignore
	 * @param {JQuery.Object} $el Element which will render a drawer on click
	 * @param {number} section number representing the section
	 */
	function makeCta( $el, section ) {
		$el
			.on( 'click', function ( ev ) {
				ev.preventDefault();
				// prevent folding section when clicking Edit
				ev.stopPropagation();
				// need to use toggle() because we do ev.stopPropagation() (in addEditButton())
				if ( !drawer ) {
					drawer = new CtaDrawer( {
						queryParams: {
							returnto: mw.config.get( 'wgPageName' ),
							returntoquery: 'action=edit&section=' + section,
							warning: 'mobile-frontend-edit-login-action',
							campaign: 'mobile_editPageActionCta'
						},
						signupQueryParams: {
							returntoquery: 'article_action=signup-edit',
							warning: 'mobile-frontend-edit-signup-action'
						},
						content: mw.msg( 'mobile-frontend-editor-cta' )
					} );
				}
				drawer
					.toggle();
			} )
			// needed until we use tap everywhere to prevent the link from being followed
			.on( 'click', false );
	}

	/**
	 * Retrieve the user's preferred editor setting. If none is set, return the default
	 * editor for this wiki.
	 * @method
	 * @ignore
	 * @return {string} Either 'VisualEditor' or 'SourceEditor'
	 */
	function getPreferredEditor() {
		var preferredEditor = mw.storage.get( 'preferredEditor' );
		if ( !preferredEditor ) {
			// For now, we are going to ignore which editor is set as the default for the
			// wiki and always default to the source editor. Once we decide to honor the
			// default editor setting for the wiki, we'll want to use:
			// visualEditorDefault = veConfig && veConfig.defaultUserOptions && veConfig.defaultUserOptions.enable;
			// return visualEditorDefault ? 'VisualEditor' : 'SourceEditor';
			return 'SourceEditor';
		} else {
			return preferredEditor;
		}
	}

	/**
	 * Initialize the edit button so that it launches the editor interface when clicked.
	 * @method
	 * @ignore
	 * @param {Page} page The page to edit.
	 */
	function setupEditor( page ) {
		var uri, fragment, editorOverride,
			isNewPage = page.options.id === 0,
			leadSection = page.getLeadSectionElement();

		if ( mw.util.getParamValue( 'undo' ) ) {
			// TODO: Replace with an OOUI dialog
			// eslint-disable-next-line no-alert
			alert( mw.msg( 'mobile-frontend-editor-undo-unsupported' ) );
		}

		page.$( '.edit-page, .edit-link' ).removeClass( disabledClass )
			.on( 'click', onEditLinkClick );
		overlayManager.add( /^\/editor\/(\d+|all)$/, function ( sectionId ) {
			var
				$content = $( '#mw-content-text' ),
				preferredEditor = getPreferredEditor(),
				editorOptions = {
					overlayManager: overlayManager,
					api: new mw.Api(),
					licenseMsg: skin.getLicenseMsg(),
					title: page.title,
					isAnon: user.isAnon(),
					isNewPage: isNewPage,
					isNewEditor: user.getEditCount() === 0,
					oldId: mw.util.getParamValue( 'oldid' ),
					contentLang: $content.attr( 'lang' ),
					contentDir: $content.attr( 'dir' ),
					sessionId: mw.user.generateRandomSessionId()
				},
				visualEditorNamespaces = veConfig && veConfig.namespaces,
				initMechanism = mw.util.getParamValue( 'redlink' ) ? 'new' : 'click';

			/**
			 * Log init event to edit schema.
			 * Need to log this from outside the Overlay object because that module
			 * won't have loaded yet.
			 * @private
			 * @ignore
			 * @param {string} editor name e.g. wikitext or visualeditor
			 * @method
			 */
			function logInit( editor ) {
				// If MobileFrontend is not available this will not be possible so
				// check first.
				mw.loader.using( 'mobile.loggingSchemas.edit' ).then( function () {
					mw.track( 'mf.schemaEdit', {
						action: 'init',
						type: 'section',
						mechanism: initMechanism,
						editor: editor,
						editingSessionId: editorOptions.sessionId
					} );
				} );
			}

			/**
			 * Load source editor
			 * @private
			 * @ignore
			 * @method
			 * @returns {JQuery.Promise}
			 */
			function loadSourceEditor() {
				logInit( 'wikitext' );

				return loader.loadModule( 'mobile.editor.overlay' ).then( function () {
					var EditorOverlay = M.require( 'mobile.editor.overlay/EditorOverlay' );
					return new EditorOverlay( editorOptions );
				} );
			}

			if ( sectionId !== 'all' ) {
				editorOptions.sectionId = page.isWikiText() ? +sectionId : null;
			}

			// Check whether VisualEditor should be loaded
			if ( isVisualEditorEnabled &&

				// Only for pages with a wikitext content model
				page.isWikiText() &&

				// Only in enabled namespaces
				$.inArray( mw.config.get( 'wgNamespaceNumber' ), visualEditorNamespaces ) > -1 &&

				// Not on pages which are outputs of the Page Translation feature
				mw.config.get( 'wgTranslatePageTranslation' ) !== 'translation' &&

				(
					// If the user prefers the VisualEditor or the user has no preference and
					// the VisualEditor is the default editor for this wiki
					preferredEditor === 'VisualEditor' ||
					// We've loaded it via the URL for this request
					editorOverride === 'VisualEditor'
				) &&

				editorOverride !== 'SourceEditor'
			) {
				logInit( 'visualeditor' );
				return loader.loadModule( 'mobile.editor.ve' ).then( function () {
					var VisualEditorOverlay = M.require( 'mobile.editor.ve/VisualEditorOverlay' );
					return new VisualEditorOverlay( editorOptions );
				}, loadSourceEditor );
			} else {
				return loadSourceEditor();
			}
		} );
		updateEditPageButton( true );
		// reveal edit links on user pages
		page.$( '.edit-link' ).removeClass( 'hidden' );
		currentPage.getRedLinks().on( 'click', function ( ev ) {
			var drawerOptions = {
					progressiveButton: new Button( {
						progressive: true,
						label: mw.msg( 'mobile-frontend-editor-redlink-create' ),
						href: $( this ).attr( 'href' )
					} ).options,
					closeAnchor: new Anchor( {
						progressive: true,
						label: mw.msg( 'mobile-frontend-editor-redlink-leave' ),
						additionalClassNames: 'hide'
					} ).options,
					content: mw.msg( 'mobile-frontend-editor-redlink-explain' ),
					actionAnchor: false
				},
				drawer = new CtaDrawer( drawerOptions );

			// use preventDefault() and not return false to close other open drawers or anything else.
			ev.preventDefault();
			drawer.show();
		} );

		// Make sure we never create two edit links by accident
		// FIXME: split the selector and cache it
		if ( $caEdit.find( '.edit-page' ).length === 0 ) {
			if ( isNewPage ||
					( leadSection && leadSection.text() ) || page.getSections().length === 0 ) {
				// if lead section is not empty, open editor with lead section
				// In some namespaces (controlled by MFNamespacesWithoutCollapsibleSections)
				// sections are not marked. Use the lead section for such cases.
				addEditButton( 0, '#ca-edit' );
			} else if ( leadSection !== null ) {
				// if lead section is empty open editor with first section
				// be careful not to do this when leadSection is null as this means MobileFormatter has not
				// been run and thus we could not identify the lead
				addEditButton( 1, '#ca-edit' );
			}
		}

		// enable all edit pencils in sub-sections for the article namespace
		if ( currentPage.getNamespaceId() === 0 ) {
			$( '.in-block>.edit-page' ).show();
		}

		if ( !router.getPath() && ( mw.util.getParamValue( 'veaction' ) || mw.util.getParamValue( 'action' ) === 'edit' ) ) {
			if ( mw.util.getParamValue( 'veaction' ) === 'edit' ) {
				editorOverride = 'VisualEditor';
			} else if ( mw.util.getParamValue( 'veaction' ) === 'editsource' ) {
				editorOverride = 'SourceEditor';
			}
			// else: action=edit, for which we allow the default to take effect
			fragment = '#/editor/' + ( mw.util.getParamValue( 'section' ) || ( mw.util.getParamValue( 'action' ) === 'edit' && 'all' ) || '0' );
			if ( window.history && history.pushState ) {
				uri = mw.Uri();
				delete uri.query.action;
				delete uri.query.veaction;
				delete uri.query.section;
				// Note: replaceState rather than pushState, because we're
				// just reformatting the URL to the equivalent-meaning for the
				// mobile site.
				history.replaceState( null, document.title, uri.toString() + fragment );
			} else {
				router.navigate( fragment );
			}
		}

		if ( blockInfo ) {
			updateEditPageButton( false );
		}
	}

	/**
	 * Setup the editor if the user can edit the page otherwise show a sorry toast.
	 * @method
	 * @ignore
	 */
	function init() {
		if ( isEditable ) {
			// Edit button updated in setupEditor.
			setupEditor( currentPage );
		} else {
			updateEditPageButton( false );
			showSorryToast( editErrorMessage );
		}
	}

	/**
	 * Initialize the edit button so that it launches a login call-to-action when clicked.
	 * @method
	 * @ignore
	 */
	function initCta() {
		// Initialize edit button links (to show Cta) only, if page is editable,
		// otherwise show an error toast
		if ( isEditable ) {
			updateEditPageButton( true );
			// Init lead section edit button
			makeCta( $caEdit, 0 );

			// Init all edit links (including lead section, if anonymous editing is enabled)
			$( '.edit-page' ).each( function () {
				var $a = $( this ),
					section = 0;

				if ( $( this ).data( 'section' ) !== undefined ) {
					section = $( this ).data( 'section' );
				}
				makeCta( $a, section );
			} );
		} else {
			updateEditPageButton( false );
			showSorryToast( editErrorMessage );
		}
	}

	/**
	 * Show a toast message with sincere condolences.
	 * @method
	 * @ignore
	 * @param {string} msg Message for sorry message
	 */
	function showSorryToast( msg ) {
		$( '#ca-edit, .edit-page' ).on( 'click', function ( ev ) {
			popup.show( msg );
			ev.preventDefault();
		} );
	}

	if ( contentModel !== 'wikitext' ) {
		// Only load the wikitext editor on wikitext. Otherwise we'll rely on the fallback behaviour
		// (You can test this on MediaWiki:Common.css) ?action=edit url (T173800)
		return;
	} else if ( !isEditingSupported ) {
		// Editing is disabled (or browser is blacklisted)
		updateEditPageButton( false );
		showSorryToast( mw.msg( 'mobile-frontend-editor-unavailable' ) );
	} else if ( isNewFile ) {
		updateEditPageButton( true );
		// Is a new file page (enable upload image only) Bug 58311
		showSorryToast( mw.msg( 'mobile-frontend-editor-uploadenable' ) );
	} else {
		// Edit button is currently hidden. A call to init() / initCta() will update
		// it as needed.
		if ( user.isAnon() ) {
			// Cta's will be rendered in EditorOverlay, if anonymous editing is enabled.
			if ( mw.config.get( 'wgMFEditorOptions' ).anonymousEditing ) {
				init();
			} else {
				initCta();
			}
		} else {
			init();
		}
	}
}( mw.mobileFrontend, jQuery ) );
