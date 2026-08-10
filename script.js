/* Smooth section scrolling + dot indicator, index.html.

   CSS scroll-snap is still declared in style.css and is what runs if
   this file never loads. When it does load, jQuery takes over the
   motion: the browser's snap engine and an animated scrollTop fight
   over the same property, so snapping is suspended for the duration of
   each animation and restored afterwards. */

$(function () {
    var $sections = $('[data-section]');
    if (!$sections.length) {
        return;
    }

    var $root = $('html');
    var $scroller = $('html, body'); // Which one scrolls varies by browser; animate both.
    var $dotNav = $('.dot-nav');

    var DURATION = 750;
    var current = 0;
    var animating = false;

    /* jQuery core only ships "swing" and "linear". This is the ease the
       whole page uses: slow at both ends, quick through the middle. */
    $.easing.esportEase = function (x) {
        return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    };

    // ---------------------------------------------------------------
    // Build the dots
    // ---------------------------------------------------------------

    $sections.each(function (i) {
        $('<button>', {
            type: 'button',
            'class': 'dot',
            'data-index': i,
            'aria-label': 'Go to ' + $(this).data('section'),
            html: '<span class="dot-label">' + $(this).data('section') + '</span>'
        }).appendTo($dotNav);
    });

    var $dots = $dotNav.find('.dot');

    // ---------------------------------------------------------------
    // Scrolling
    // ---------------------------------------------------------------

    function goTo(index) {
        index = Math.max(0, Math.min(index, $sections.length - 1));
        if (animating || index === current) {
            return;
        }

        animating = true;
        setActive(index);

        // Snapping off for the duration, or the browser yanks the
        // viewport back to a snap point on every animation frame.
        $root.addClass('is-scrolling');

        $scroller.stop(true).animate(
            { scrollTop: $sections.eq(index).offset().top },
            {
                duration: DURATION,
                easing: 'esportEase',
                complete: function () {
                    /* animate() runs on html AND body, so complete fires
                       twice; the flag is cleared on the first one. Also
                       let the scroll settle a frame before re-arming
                       snap, otherwise it can re-snap to the old section. */
                    if (!animating) {
                        return;
                    }
                    animating = false;
                    setTimeout(function () {
                        $root.removeClass('is-scrolling');
                    }, 50);
                }
            }
        );
    }

    function setActive(index) {
        current = index;
        $dots.removeClass('active').eq(index).addClass('active');

        // White dots vanish on the one light section, so flip them.
        var isLight = $sections.eq(index).data('nav-theme') === 'light';
        $dotNav.toggleClass('on-light', isLight);
    }

    $dots.on('click', function () {
        goTo($(this).data('index'));
    });

    // ---------------------------------------------------------------
    // Scroll spy — keeps the dots honest when scrolling by hand
    // ---------------------------------------------------------------

    function syncFromScroll() {
        if (animating) {
            return;
        }

        var middle = $(window).scrollTop() + $(window).height() / 2;
        var found = 0;

        $sections.each(function (i) {
            var top = $(this).offset().top;
            if (middle >= top) {
                found = i;
            }
        });

        if (found !== current) {
            setActive(found);
        }
    }

    /* scroll fires far faster than the screen repaints; coalescing into
       one rAF keeps the handler off the critical path. */
    var queued = false;
    $(window).on('scroll resize', function () {
        if (queued) {
            return;
        }
        queued = true;
        requestAnimationFrame(function () {
            queued = false;
            syncFromScroll();
        });
    });

    // ---------------------------------------------------------------
    // Wheel + keyboard, desktop only
    // ---------------------------------------------------------------

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var desktop = window.matchMedia('(min-width: 768px)');

    /* Not $(window).on('wheel') — Chrome forces wheel listeners on
       window/document/body to be passive, and preventDefault() is a
       no-op (plus a console warning) inside a passive listener. The
       only way to keep the default scroll suppressed is to register it
       natively with passive:false.

       Touch scrolling is left entirely alone — hijacking it breaks
       momentum and fights the browser's own overscroll behaviour. */
    window.addEventListener('wheel', function (e) {
        if (!desktop.matches || reduceMotion.matches) {
            return;
        }

        var delta = e.deltaY;
        if (Math.abs(delta) < 4) {
            return;
        }

        /* A section taller than the viewport (small laptops, three
           stacked cards) has to scroll through internally before we
           hand over to the next one. */
        var $section = $sections.eq(current);
        var top = $section.offset().top;
        var bottom = top + $section.outerHeight();
        var viewTop = $(window).scrollTop();
        var viewBottom = viewTop + $(window).height();

        if (delta > 0 && viewBottom < bottom - 2) {
            return;
        }
        if (delta < 0 && viewTop > top + 2) {
            return;
        }

        e.preventDefault();
        goTo(current + (delta > 0 ? 1 : -1));
    }, { passive: false });

    $(document).on('keydown', function (e) {
        // Typing in a field must keep its own arrow/page behaviour.
        if ($(e.target).is('input, textarea, select') || e.target.isContentEditable) {
            return;
        }

        var keys = { PageDown: 1, PageUp: -1, ArrowDown: 1, ArrowUp: -1 };
        if (e.key in keys) {
            e.preventDefault();
            goTo(current + keys[e.key]);
        } else if (e.key === 'Home') {
            e.preventDefault();
            goTo(0);
        } else if (e.key === 'End') {
            e.preventDefault();
            goTo($sections.length - 1);
        }
    });

    // ---------------------------------------------------------------

    // JOIN NOW scrolls to the membership teaser rather than doing nothing.
    $('.welcome-section-button').on('click', function () {
        goTo($sections.length - 1);
    });

    syncFromScroll();
    setActive(current);
});
