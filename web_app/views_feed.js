/* RideRise LK — Home community feed, post composer, comments, reports & pre-ride safety check */
(function () {
  'use strict';
  const { api, state, t, escapeHtml, toast, modal, closeModal, avatar, timeAgo, skeletonList, emptyState, errorState } = window.RR;

  const CATEGORIES = [
    ['', 'All posts'],
    ['build_showcase', 'Build showcase'],
    ['maintenance_upgrade', 'Maintenance & upgrades'],
    ['riding_recap', 'Riding recaps'],
    ['skill_progress', 'Skill progress'],
    ['community_qa', 'Questions & tips'],
    ['short_clip', 'Short clips'],
    ['marketplace', 'Buy / sell / trade']
  ];

  const REPORT_REASONS = [
    ['bullying_harassment', 'Bullying or harassment'],
    ['threats_violence', 'Threats or violence'],
    ['impersonation', 'Impersonation'],
    ['unwanted_sexual_content', 'Unwanted sexual content'],
    ['suspicious_pii_request', 'Suspicious request for personal information'],
    ['dangerous_road_stunt', 'Dangerous stunt in traffic / on public roads'],
    ['scam_marketplace', 'Scam or unsafe marketplace listing'],
    ['other', 'Something else']
  ];

  const feedState = { category: '', search: '', posts: [], offset: 0, limit: 8, loading: false, hasMore: false };

  async function renderHome(viewport) {
    if (!state.token) {
      location.hash = '#/welcome';
      return;
    }
    viewport.innerHTML = `
      <section class="safety-strip" role="note">
        <div>
          <strong>${escapeHtml(t('safetyBannerTitle'))}</strong>
          <div style="font-size:.78rem;color:var(--text-secondary)">${escapeHtml(t('safetyBannerSub'))}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-safety btn-sm" id="feedSafetyBtn">Safety Centre</button>
          <button class="btn btn-sm btn-secondary" id="feedPreRideBtn">${escapeHtml(t('preRideCheckBtn'))}</button>
        </div>
      </section>

      <section class="home-hero card card-accent">
        <div class="home-hero-left">
          <div class="home-greeting">Welcome back${state.profile ? `, ${escapeHtml((state.profile.display_name || '').split(' ')[0])}` : ''} 👋</div>
          <p class="muted">Share a build, ask for help, log a safe practice session — and keep progression honest.</p>
          <div class="home-hero-actions">
            <button class="btn btn-primary" id="composeBtn">${escapeHtml(t('newPostBtn'))}</button>
            <button class="btn btn-secondary" id="discoverRidersBtn">Find riders</button>
          </div>
        </div>
        <div class="home-hero-right">
          ${state.profile ? window.RR.xpProgress(state.profile) : ''}
        </div>
      </section>

      <div class="chip-bar" id="categoryChips" role="tablist" aria-label="Post categories">
        ${CATEGORIES.map(
          ([value, label]) =>
            `<button type="button" role="tab" class="chip ${feedState.category === value ? 'active' : ''}" data-cat="${value}" aria-selected="${
              feedState.category === value
            }">${escapeHtml(label)}</button>`
        ).join('')}
      </div>

      <div class="feed-toolbar">
        <input class="form-input" id="feedSearch" type="search" placeholder="Search posts, riders, tags…" value="${escapeHtml(feedState.search)}" aria-label="Search the feed" />
        <button class="btn btn-secondary btn-sm" id="refreshFeedBtn" title="Refresh feed">↻ Refresh</button>
      </div>

      <div id="feedList">${skeletonList(3)}</div>
      <div id="feedFooter"></div>`;

    viewport.querySelector('#feedSafetyBtn').addEventListener('click', () => (location.hash = '#/safety'));
    viewport.querySelector('#feedPreRideBtn').addEventListener('click', openSafetyChecklist);
    viewport.querySelector('#composeBtn').addEventListener('click', () => openComposer(() => loadFeed(true)));
    viewport.querySelector('#discoverRidersBtn').addEventListener('click', () => (location.hash = '#/explore'));
    viewport.querySelector('#refreshFeedBtn').addEventListener('click', () => loadFeed(true));
    let searchTimer = null;
    viewport.querySelector('#feedSearch').addEventListener('input', (e) => {
      feedState.search = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadFeed(true), 350);
    });
    viewport.querySelectorAll('[data-cat]').forEach((chip) =>
      chip.addEventListener('click', () => {
        feedState.category = chip.dataset.cat;
        viewport.querySelectorAll('[data-cat]').forEach((c) => {
          c.classList.toggle('active', c.dataset.cat === feedState.category);
          c.setAttribute('aria-selected', c.dataset.cat === feedState.category ? 'true' : 'false');
        });
        loadFeed(true);
      })
    );

    wirePullToRefresh(() => loadFeed(true));
    await loadFeed(true);
  }

  function wirePullToRefresh(onRefresh) {
    let startY = null;
    let pulling = false;
    const threshold = 70;
    const viewport = document.getElementById('mainViewport');
    if (!viewport || viewport.dataset.ptrWired === '1') return;
    viewport.dataset.ptrWired = '1';
    viewport.addEventListener(
      'touchstart',
      (e) => {
        if (window.scrollY > 0 || e.touches.length !== 1) return;
        startY = e.touches[0].clientY;
        pulling = true;
      },
      { passive: true }
    );
    viewport.addEventListener(
      'touchmove',
      (e) => {
        if (!pulling || startY === null) return;
        const delta = e.touches[0].clientY - startY;
        if (delta > threshold && !feedState.loading) {
          pulling = false;
          startY = null;
          toast('Refreshing feed…', 'info', 1500);
          onRefresh();
        }
      },
      { passive: true }
    );
    viewport.addEventListener('touchend', () => {
      pulling = false;
      startY = null;
    });
  }

  async function loadFeed(reset = false) {
    const list = document.getElementById('feedList');
    const footer = document.getElementById('feedFooter');
    if (!list || feedState.loading) return;
    feedState.loading = true;
    if (reset) {
      feedState.offset = 0;
      list.innerHTML = skeletonList(3);
      footer.innerHTML = '';
    }
    try {
      const params = new URLSearchParams({ limit: String(feedState.limit), offset: String(feedState.offset) });
      if (feedState.category) params.set('category', feedState.category);
      if (feedState.search) params.set('search', feedState.search);
      const data = await api(`/api/posts?${params.toString()}`);
      const posts = data.posts || [];
      feedState.posts = reset ? posts : feedState.posts.concat(posts);
      feedState.hasMore = data.hasMore;
      feedState.offset = feedState.posts.length;
      renderPosts();
    } catch (err) {
      list.innerHTML = errorState(err);
      const retry = list.querySelector('[data-retry]');
      if (retry) retry.addEventListener('click', () => loadFeed(true));
    } finally {
      feedState.loading = false;
    }
  }

  function renderPosts() {
    const list = document.getElementById('feedList');
    const footer = document.getElementById('feedFooter');
    if (!list) return;
    if (!feedState.posts.length) {
      list.innerHTML = emptyState({
        icon: '🚲',
        title: 'No posts yet in this view',
        body: 'Publish the first build showcase, maintenance tip or practice log for the Sri Lankan riding community.',
        actionHtml: '<button class="btn btn-primary" id="emptyCompose">Create a post</button>'
      });
      const btn = list.querySelector('#emptyCompose');
      if (btn) btn.addEventListener('click', () => openComposer(() => loadFeed(true)));
      footer.innerHTML = '';
      return;
    }
    list.innerHTML = feedState.posts.map(postCard).join('');
    footer.innerHTML = feedState.hasMore
      ? '<button class="btn btn-secondary" id="loadMore" style="width:100%">Load more posts</button>'
      : '<p class="feed-end">You are all caught up · RideRise LK community</p>';

    const loadMore = document.getElementById('loadMore');
    if (loadMore) loadMore.addEventListener('click', () => loadFeed(false));
    wirePostActions();
  }

  function categoryLabel(cat) {
    const found = CATEGORIES.find(([value]) => value === cat);
    return found ? found[1] : 'Post';
  }

  function postCard(post) {
    const isMine = state.profile && post.user_id === state.profile.user_id;
    const pending = post.moderation_status === 'pending_review';
    return `<article class="card post-card" data-post="${escapeHtml(post.id)}">
      <header class="post-head">
        <button class="post-author" data-profile="${escapeHtml(post.user_id)}" aria-label="View ${escapeHtml(post.display_name)} profile">
          ${avatar(post.avatar_url, post.display_name, 44)}
          <span class="post-author-text">
            <strong>${escapeHtml(post.display_name)}</strong>
            <small>@${escapeHtml(post.username)} · ${escapeHtml(post.district || 'Sri Lanka')}</small>
          </span>
        </button>
        <div class="post-head-right">
          <span class="pill-badge" style="background:${escapeHtml(post.rank_color || '#FF6B00')}22;color:${escapeHtml(
      post.rank_color || '#FF6B00'
    )};border:1px solid ${escapeHtml(post.rank_color || '#FF6B00')}55">${escapeHtml(post.rank_name || 'Rider')}</span>
          <span class="post-time">${escapeHtml(timeAgo(post.created_at))}</span>
          <button class="icon-btn" data-post-menu="${escapeHtml(post.id)}" aria-label="Post options">⋯</button>
        </div>
      </header>
      <div class="post-chip-row">
        <span class="pill-badge pill-cyan">${escapeHtml(categoryLabel(post.category))}</span>
        ${post.guild_name ? `<span class="pill-badge pill-orange">🛡️ ${escapeHtml(post.guild_name)}</span>` : ''}
        ${post.bike_name ? `<span class="pill-badge pill-green">🔧 ${escapeHtml(post.bike_name)} · ${post.bike_build_score}/100</span>` : ''}
        ${pending ? '<span class="pill-badge pill-red">⏳ Pending moderation review</span>' : ''}
      </div>
      <h3 class="post-title">${escapeHtml(post.title)}</h3>
      <p class="post-body">${linkify(escapeHtml(post.body))}</p>
      ${
        post.media_urls && post.media_urls.length
          ? `<div class="post-media ${post.media_urls.length > 1 ? 'multi' : ''}">
               ${
                 post.media_type === 'video'
                   ? `<video controls preload="metadata" src="${escapeHtml(post.media_urls[0])}" aria-label="Short video clip"></video>`
                   : post.media_urls
                       .slice(0, 4)
                       .map((u) => `<img src="${escapeHtml(u)}" alt="Post media" loading="lazy" />`)
                       .join('')
               }
             </div>`
          : ''
      }
      ${
        post.tags && post.tags.length
          ? `<div class="tag-row">${post.tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}</div>`
          : ''
      }
      <footer class="post-actions">
        <button class="post-action ${post.liked_by_me ? 'active' : ''}" data-like="${escapeHtml(post.id)}" aria-pressed="${!!post.liked_by_me}">
          ${post.liked_by_me ? '💛' : '🤍'} <span>${post.likes_count}</span>
        </button>
        <button class="post-action" data-comments="${escapeHtml(post.id)}">💬 <span>${post.comments ? post.comments.length : 0}</span></button>
        <button class="post-action ${post.bookmarked_by_me ? 'active' : ''}" data-bookmark="${escapeHtml(post.id)}">${post.bookmarked_by_me ? '🔖' : '📑'}</button>
        <button class="post-action" data-share="${escapeHtml(post.id)}">↗ Share</button>
        <button class="post-action danger" data-report="${escapeHtml(post.id)}" data-report-type="post">⚑ Report</button>
        ${isMine ? `<button class="post-action" data-edit="${escapeHtml(post.id)}">✎ Edit</button>` : ''}
      </footer>
      <section class="comment-section" id="comments-${escapeHtml(post.id)}" hidden>
        <div class="comment-list">
          ${
            post.comments && post.comments.length
              ? post.comments
                  .map(
                    (c) => `<div class="comment ${c.parent_comment_id ? 'reply' : ''}">
                      ${avatar(c.avatar_url, c.display_name, 28)}
                      <div class="comment-body">
                        <div><strong>@${escapeHtml(c.username)}</strong> <span class="post-time">${escapeHtml(timeAgo(c.created_at))}</span></div>
                        <p>${linkify(escapeHtml(c.body))}</p>
                        <button class="link-inline" data-reply="${escapeHtml(post.id)}" data-parent="${escapeHtml(c.id)}"
                          data-mention="${escapeHtml(c.username)}">Reply</button>
                      </div>
                    </div>`
                  )
                  .join('')
              : '<p class="muted" style="font-size:.8rem">No comments yet — be the first to help.</p>'
          }
        </div>
        <form class="comment-form" data-comment-form="${escapeHtml(post.id)}">
          <input class="form-input" name="comment" placeholder="Add a supportive or useful comment…" maxlength="500" required />
          <button class="btn btn-primary btn-sm" type="submit">Send</button>
        </form>
      </section>
    </article>`;
  }

  function linkify(text) {
    return text
      .replace(/@([a-z0-9_]{3,24})/gi, '<span class="mention">@$1</span>')
      .replace(/\n/g, '<br/>');
  }

  function wirePostActions() {
    document.querySelectorAll('[data-like]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          const result = await api(`/api/posts/${btn.dataset.like}/like`, { method: 'POST' });
          const post = feedState.posts.find((p) => p.id === btn.dataset.like);
          if (post) {
            post.liked_by_me = result.liked;
            post.likes_count += result.liked ? 1 : -1;
          }
          btn.classList.toggle('active', result.liked);
          btn.setAttribute('aria-pressed', result.liked);
          btn.innerHTML = `${result.liked ? '💛' : '🤍'} <span>${post ? post.likes_count : ''}</span>`;
        } catch (err) {
          toast(err.message, 'error');
        }
      })
    );

    document.querySelectorAll('[data-bookmark]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          const result = await api(`/api/posts/${btn.dataset.bookmark}/bookmark`, { method: 'POST' });
          btn.classList.toggle('active', result.bookmarked);
          btn.textContent = result.bookmarked ? '🔖' : '📑';
          toast(result.bookmarked ? 'Saved to your bookmarks.' : 'Removed from bookmarks.', 'success', 2200);
        } catch (err) {
          toast(err.message, 'error');
        }
      })
    );

    document.querySelectorAll('[data-comments]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const section = document.getElementById(`comments-${btn.dataset.comments}`);
        if (section) section.hidden = !section.hidden;
      })
    );

    document.querySelectorAll('[data-share]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const post = feedState.posts.find((p) => p.id === btn.dataset.share);
        if (!post) return;
        sharePost(post);
      })
    );

    document.querySelectorAll('[data-report]').forEach((btn) =>
      btn.addEventListener('click', () => openReport(btn.dataset.report, btn.dataset.reportType))
    );

    document.querySelectorAll('[data-post-menu]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const post = feedState.posts.find((p) => p.id === btn.dataset.postMenu);
        if (!post) return;
        openPostMenu(post);
      })
    );

    document.querySelectorAll('[data-edit]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const post = feedState.posts.find((p) => p.id === btn.dataset.edit);
        if (post) openComposer(() => loadFeed(true), post);
      })
    );

    document.querySelectorAll('[data-profile]').forEach((btn) =>
      btn.addEventListener('click', () => (location.hash = `#/user/${btn.dataset.profile}`))
    );

    document.querySelectorAll('[data-reply]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const form = document.querySelector(`[data-comment-form="${btn.dataset.reply}"]`);
        if (!form) return;
        form.querySelector('input').value = `@${btn.dataset.mention} `;
        form.dataset.parent = btn.dataset.parent;
        form.querySelector('input').focus();
      })
    );

    document.querySelectorAll('[data-comment-form]').forEach((form) =>
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = form.querySelector('input');
        const body = input.value.trim();
        if (!body) return;
        try {
          await api(`/api/posts/${form.dataset.commentForm}/comments`, {
            method: 'POST',
            body: { body, parent_comment_id: form.dataset.parent || null }
          });
          input.value = '';
          toast('Comment added.', 'success', 2200);
          await loadFeed(true);
        } catch (err) {
          toast(err.message, 'error');
        }
      })
    );
  }

  async function sharePost(post) {
    const shareText = `${post.title} — ${post.display_name} on RideRise LK by Shaun David Studios\n#RideRiseLK #BMXSriLanka`;
    if (window.RRAndroid && window.RRAndroid.shareText) {
      try {
        window.RRAndroid.shareText(post.title, shareText);
        toast('Opening Android share sheet…', 'success', 2200);
        return;
      } catch (e) {
        /* fall through */
      }
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: post.title, text: shareText });
        return;
      } catch (e) {
        /* user cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      toast('Share text copied to clipboard.', 'success');
    } catch (e) {
      modal({
        title: 'Share this post',
        body: `<p class="muted">Copy the text below into any app:</p><textarea class="form-textarea" rows="4" readonly>${escapeHtml(
          shareText
        )}</textarea>`,
        footer: '<button class="btn btn-secondary" data-modal-close="1">Close</button>',
        onMount(root) {
          root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
        }
      });
    }
  }

  function openPostMenu(post) {
    const isMine = state.profile && post.user_id === state.profile.user_id;
    const isAdmin = state.account && state.account.role === 'admin';
    modal({
      title: 'Post options',
      size: '460px',
      body: `<div class="menu-list">
        <button class="menu-item" data-action="view">👤 View ${escapeHtml(post.display_name)}'s profile</button>
        <button class="menu-item" data-action="report">⚑ Report this post</button>
        ${isMine ? '<button class="menu-item" data-action="edit">✎ Edit post</button>' : ''}
        ${isMine || isAdmin ? '<button class="menu-item danger" data-action="delete">🗑 Delete post</button>' : ''}
      </div>`,
      onMount(root) {
        root.querySelectorAll('[data-action]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            closeModal();
            if (action === 'view') location.hash = `#/user/${post.user_id}`;
            if (action === 'report') openReport(post.id, 'post');
            if (action === 'edit') openComposer(() => loadFeed(true), post);
            if (action === 'delete') {
              if (!confirm('Delete this post permanently? This cannot be undone.')) return;
              try {
                await api(`/api/posts/${post.id}`, { method: 'DELETE' });
                toast('Post deleted.', 'success');
                loadFeed(true);
              } catch (err) {
                toast(err.message, 'error');
              }
            }
          })
        );
      }
    });
  }

  /* --------------------------------- Composer -------------------------------- */
  async function openComposer(onDone, existing = null) {
    let bikes = [];
    let guilds = [];
    try {
      const [bikeData, guildData] = await Promise.all([api('/api/bicycles'), api('/api/guilds')]);
      bikes = bikeData.bicycles || [];
      guilds = (guildData.guilds || []).filter((g) => g.my_status === 'active');
    } catch (err) {
      /* keep empty lists; the composer still works */
    }
    const mediaUrls = existing && existing.media_urls ? existing.media_urls.slice() : [];
    let mediaKind = existing && existing.media_type ? existing.media_type : 'none';

    modal({
      title: existing ? 'Edit post' : 'Publish to the community',
      size: '720px',
      body: `<form id="composerForm" class="composer">
        <div class="form-group">
          <label class="form-label" for="postCategory">Category</label>
          <select class="form-select" id="postCategory" ${existing ? 'disabled' : ''}>
            ${CATEGORIES.filter(([v]) => v)
              .map(
                ([v, l]) =>
                  `<option value="${v}" ${existing && existing.category === v ? 'selected' : ''}>${escapeHtml(l)}</option>`
              )
              .join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="postTitle">Title</label>
          <input class="form-input" id="postTitle" maxlength="120" required value="${existing ? escapeHtml(existing.title) : ''}" placeholder="e.g. Dialled in my 20.75in chromoly build" />
        </div>
        <div class="form-group">
          <label class="form-label" for="postBody">Details ${existing ? '' : '<span class="hint">(mentions: @username)</span>'}</label>
          <textarea class="form-textarea" id="postBody" rows="5" required maxlength="2000" placeholder="Share the build list, maintenance steps, practice notes or your question…">${existing ? escapeHtml(existing.body) : ''}</textarea>
        </div>
        <div class="grid-2" style="gap:12px">
          <div class="form-group">
            <label class="form-label" for="postTags">Tags (comma separated, max 6)</label>
            <input class="form-input" id="postTags" value="${existing && existing.tags ? escapeHtml(existing.tags.join(', ')) : ''}" placeholder="Chromoly4130, BrakeSafety" />
          </div>
          <div class="form-group">
            <label class="form-label" for="postBike">Attach a bicycle</label>
            <select class="form-select" id="postBike">
              <option value="">No bicycle</option>
              ${bikes
                .map((b) => `<option value="${b.id}" ${existing && existing.bike_id === b.id ? 'selected' : ''}>${escapeHtml(b.name)} · ${b.build_score}/100</option>`)
                .join('')}
            </select>
          </div>
        </div>
        ${
          guilds.length
            ? `<div class="form-group">
                 <label class="form-label" for="postGuild">Share to a guild (optional)</label>
                 <select class="form-select" id="postGuild">
                   <option value="">Public feed only</option>
                   ${guilds
                     .map((g) => `<option value="${g.id}" ${existing && existing.guild_id === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`)
                     .join('')}
                 </select>
               </div>`
            : ''
        }
        <div class="form-group">
          <label class="form-label" for="postMedia">Photos or a short clip</label>
          <input class="form-input" type="file" id="postMedia" accept="image/*,video/mp4" ${existing ? 'disabled' : ''} />
          <div class="hint">Images up to 5 MB (PNG/JPEG/WebP) or one MP4 clip up to 8 MB. Short clips are moderated under the same guidelines as posts. EXIF GPS metadata is stripped.</div>
          <div id="uploadProgress" class="upload-progress" hidden><div id="uploadProgressBar"></div></div>
          <div id="mediaPreview" class="media-preview">
            ${mediaUrls.map((u) => `<img src="${escapeHtml(u)}" alt="Attached media" />`).join('')}
          </div>
        </div>
        <div class="callout callout-warn">
          <strong>Before you publish:</strong> never post precise home locations, school details, number plates, phone numbers, or photos of people without consent.
          Never promote stunts on public roads, in traffic or near pedestrians — those posts are hidden pending moderator review and may be removed.
        </div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-modal-close="1">Cancel</button>
               <button class="btn btn-primary" id="publishBtn">${existing ? 'Save changes' : 'Publish post'}</button>`,
      onMount(root) {
        root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
        const fileInput = root.querySelector('#postMedia');
        fileInput.addEventListener('change', async () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          const isVideo = file.type === 'video/mp4';
          const limit = isVideo ? 8 * 1024 * 1024 : 5 * 1024 * 1024;
          if (file.size > limit) {
            toast(
              isVideo
                ? 'Clip exceeds the 8 MB short-video limit. Trim it and try again.'
                : 'Image exceeds the 5 MB limit. Please choose a smaller image.',
              'error'
            );
            fileInput.value = '';
            return;
          }
          if (!isVideo && !file.type.startsWith('image/')) {
            toast('Only images (PNG/JPEG/WebP) or MP4 clips can be attached.', 'error');
            fileInput.value = '';
            return;
          }
          const progress = root.querySelector('#uploadProgress');
          const bar = root.querySelector('#uploadProgressBar');
          progress.hidden = false;
          bar.style.width = '15%';
          try {
            const dataUrl = await readFileAsDataUrl(file);
            bar.style.width = '55%';
            const uploaded = await api('/api/upload/media', { method: 'POST', body: { dataUrl, fileName: file.name } });
            bar.style.width = '100%';
            mediaUrls.length = 0;
            mediaUrls.push(uploaded.mediaUrl);
            mediaKind = uploaded.mediaType || (isVideo ? 'video' : 'image');
            root.querySelector('#mediaPreview').innerHTML = isVideo
              ? `<video controls preload="metadata" src="${escapeHtml(uploaded.mediaUrl)}" aria-label="Attached clip preview"></video>`
              : `<img src="${escapeHtml(uploaded.mediaUrl)}" alt="Attached media preview" />`;
            toast(
              isVideo
                ? 'Short clip validated. Clips are moderated under the same guidelines as posts.'
                : 'Media validated and processed — EXIF location data removed.',
              'success',
              3600
            );
            setTimeout(() => (progress.hidden = true), 700);
          } catch (err) {
            progress.hidden = true;
            toast(err.message, 'error');
          }
        });

        root.querySelector('#publishBtn').addEventListener('click', async () => {
          const title = root.querySelector('#postTitle').value.trim();
          const body = root.querySelector('#postBody').value.trim();
          if (title.length < 3 || body.length < 5) {
            toast('Add a longer title and a few details before publishing.', 'error');
            return;
          }
          const btn = root.querySelector('#publishBtn');
          btn.disabled = true;
          btn.textContent = 'Publishing…';
          try {
            if (existing) {
              await api(`/api/posts/${existing.id}`, {
                method: 'PUT',
                body: { title, body, tags: splitTags(root.querySelector('#postTags').value) }
              });
              toast('Post updated.', 'success');
            } else {
              const result = await api('/api/posts', {
                method: 'POST',
                body: {
                  category: root.querySelector('#postCategory').value,
                  title,
                  body,
                  tags: splitTags(root.querySelector('#postTags').value),
                  media_urls: mediaUrls,
                  media_type: mediaUrls.length ? mediaKind : 'none',
                  bike_id: root.querySelector('#postBike').value || null,
                  guild_id: root.querySelector('#postGuild') ? root.querySelector('#postGuild').value || null : null
                }
              });
              toast(result.message || 'Post published.', result.moderationStatus === 'pending_review' ? 'info' : 'success', 5000);
            }
            closeModal();
            if (onDone) onDone();
            window.RR.refreshSession().catch(() => {});
          } catch (err) {
            toast(err.message, 'error', 6000);
            btn.disabled = false;
            btn.textContent = existing ? 'Save changes' : 'Publish post';
          }
        });
      }
    });
  }

  function splitTags(value) {
    return String(value || '')
      .split(',')
      .map((t) => t.trim().replace(/[^a-zA-Z0-9_]/g, ''))
      .filter(Boolean)
      .slice(0, 6);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.readAsDataURL(file);
    });
  }

  /* --------------------------------- Reports --------------------------------- */
  function openReport(targetId, targetType) {
    if (!state.token) {
      toast('Sign in to submit a report.', 'error');
      return;
    }
    modal({
      title: 'Report to the safety team',
      size: '560px',
      body: `<p class="muted" style="font-size:.86rem">Reports go to Shaun David Studios moderators. We never show your identity to the reported rider.</p>
        <div class="form-group">
          <label class="form-label" for="reportReason">Reason</label>
          <select class="form-select" id="reportReason">
            ${REPORT_REASONS.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="reportDetails">What happened?</label>
          <textarea class="form-textarea" id="reportDetails" rows="4" maxlength="800" required placeholder="Describe the content and why it breaks the Community Guidelines…"></textarea>
        </div>
        <div class="callout"><strong>Urgent danger?</strong> If someone is in immediate physical danger, contact local emergency services first. This report is reviewed asynchronously.</div>`,
      footer: `<button class="btn btn-secondary" data-modal-close="1">Cancel</button>
               <button class="btn btn-danger" id="submitReport">Submit report</button>`,
      onMount(root) {
        root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
        root.querySelector('#submitReport').addEventListener('click', async () => {
          const reason = root.querySelector('#reportReason').value;
          const details = root.querySelector('#reportDetails').value.trim();
          if (details.length < 4) {
            toast('Please add a short description.', 'error');
            return;
          }
          try {
            const result = await api('/api/reports', {
              method: 'POST',
              body: { target_type: targetType, target_id: targetId, reason_category: reason, details }
            });
            closeModal();
            modal({
              title: 'Report received',
              size: '480px',
              body: `<p class="muted">Ticket <code>${escapeHtml(result.reportId)}</code> was recorded. Moderators review reports with an audit trail, and you will receive a notification when your report is resolved.</p>`,
              footer: '<button class="btn btn-primary" data-modal-close="1">Done</button>',
              onMount(r2) {
                r2.querySelector('[data-modal-close]').addEventListener('click', closeModal);
              }
            });
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }
    });
  }

  /* ------------------------- 7-point pre-ride safety check ------------------- */
  function openSafetyChecklist() {
    if (!state.token) {
      toast('Sign in to record your pre-ride safety check.', 'error');
      return;
    }
    const items = [
      'Helmet is certified, undamaged and fits snugly (two-finger brow rule).',
      'Bar-end plugs are installed and grips are secure.',
      'Front and rear brakes engage firmly without bottoming out.',
      'Tires are correctly inflated with no cuts, bulges or exposed cords.',
      'Cranks, pedals and chain are tight and running smoothly.',
      'Frame, fork, stem and axle bolts show no cracks or looseness.',
      'I am practising in a legal, controlled area away from traffic and pedestrians.'
    ];
    modal({
      title: 'Pre-ride safety inspection',
      size: '620px',
      body: `<p class="muted" style="font-size:.86rem">Seven checks before every session. This is a self-inspection record — it is not a mechanical certification.</p>
        <div class="checklist">
          ${items
            .map(
              (label, i) => `<label class="check-row">
                <input type="checkbox" data-safety-item="${i}" />
                <span>${escapeHtml(label)}</span>
              </label>`
            )
            .join('')}
        </div>
        <div class="callout callout-warn"><strong>Stop conditions:</strong> cracks, bent parts, loose bolts, worn tires or faulty brakes mean <em>do not ride</em> until repaired by a qualified mechanic.</div>`,
      footer: `<button class="btn btn-secondary" data-modal-close="1">Close</button>
               <button class="btn btn-primary" id="completeSafetyBtn">Confirm inspection (+25 XP)</button>`,
      onMount(root) {
        root.querySelector('[data-modal-close]').addEventListener('click', closeModal);
        root.querySelector('#completeSafetyBtn').addEventListener('click', async () => {
          const checked = Array.from(root.querySelectorAll('[data-safety-item]')).filter((c) => c.checked);
          if (checked.length < items.length) {
            toast(`Still ${items.length - checked.length} check(s) to verify.`, 'error');
            return;
          }
          try {
            const result = await api('/api/safety/checklist', {
              method: 'POST',
              body: { checkedItems: checked.map((c) => c.dataset.safetyItem) }
            });
            closeModal();
            toast(result.message, 'success', 5000);
            if (result.xpAdded) toast(`+${result.xpAdded} safety XP credited (once per day).`, 'success', 4000);
            window.RR.refreshSession().catch(() => {});
            if (location.hash === '#/home' || location.hash === '') renderHome(document.getElementById('mainViewport'));
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }
    });
  }

  window.RRFeed = { renderHome, openComposer, openReport, openSafetyChecklist, CATEGORIES, REPORT_REASONS };
})();
