
  // --- Supabase setup ---
  // Replace with your project's values from Supabase Dashboard -> Project Settings -> API
  const SUPABASE_URL = 'https://odbsvmcpypwlwqkakxyr.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kYnN2bWNweXB3bHdxa2FreHlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNjU0OTMsImV4cCI6MjA5Njg0MTQ5M30.nlt9WuZyqFDm4eb0nuFgUpd2zwuTk643NuB8tGxLuuk';
  const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  const STORAGE_BUCKET = 'sites';
  const landingView = document.getElementById('landing-view');
  const deployView = document.getElementById('deploy-view');
  const dashboardView = document.getElementById('dashboard-view');
  const ticketGrid = document.getElementById('ticket-grid');
  const dashboardPill = document.getElementById('dashboard-pill');
  const demoPlanSelect = document.getElementById('demo-plan-select');
  const customizeModal = document.getElementById('customize-modal');

  const PLAN_LIMITS = { free: 1, mini: 2, solo: 5, pro: 15, custom: 15 };
  const PLAN_LABELS = { free: 'Free', mini: 'Mini', solo: 'Solo', pro: 'Pro', custom: 'Custom' };
  const PLAN_ORDER = ['free', 'mini', 'solo', 'pro'];
  const FEATURE_TIERS = {
    free: ['Rename site', 'Basic visit analytics'],
    mini: ['Custom address', 'QR code', 'Custom 404 page', 'Remove Vaultex banner'],
    solo: ['Feedback mode', 'Password protection', 'Detailed link tracking'],
    pro: ['Capture emails', 'In-browser file editor', 'API access']
  };
  const authArea = document.getElementById('auth-area');
  const authModal = document.getElementById('auth-modal');
  const authForm = document.getElementById('auth-form');
  const authMessage = document.getElementById('auth-message');
  const authTitle = document.getElementById('auth-title');
  const authCopy = document.getElementById('auth-copy');
  const nameField = document.getElementById('name-field');
  const confirmField = document.getElementById('confirm-field');
  const signinMeta = document.getElementById('signin-meta');
  const authPassword = document.getElementById('auth-password');
  const authConfirm = document.getElementById('auth-confirm');
  const authSubmit = document.getElementById('auth-submit');
  const passwordRow = authPassword.closest('.field-row');
  const fileInput = document.getElementById('file-input');
  const folderInput = document.getElementById('folder-input');
  const dropZone = document.getElementById('drop-zone');
  const fileList = document.getElementById('file-list');
  const fileCount = document.getElementById('file-count');
  const fileWarning = document.getElementById('file-warning');
  const clearFilesButton = document.getElementById('clear-files');
  const entryFile = document.getElementById('entry-file');
  const deployButton = document.getElementById('deploy-button');
  const deployStatus = document.getElementById('deploy-status');
  const siteUrl = document.getElementById('site-url');
  const successCard = document.getElementById('success-card');
  const successUrl = document.getElementById('success-url');

  let authMode = 'signin';
  let otpStep = 'request';
  let pendingDestination = null;
  let selectedFiles = [];
  let currentSession = null;
  let currentCustomizeIndex = null;

  function normalizeSession(session) {
    if (!session) return null;
    if (!session.plan) session.plan = 'free';
    if (!Array.isArray(session.projects)) session.projects = [];
    return session;
  }

  function isAbsoluteUrl(value) {
    return /^https?:\/\//i.test(String(value || ''));
  }

  function normalizeAssetPath(path) {
    return String(path || '')
      .replaceAll('\\', '/')
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part && part !== '.' && part !== '..')
      .join('/');
  }

  function extractSlugFromUrl(value) {
    const text = String(value || '');
    if (!text) return '';
    if (!isAbsoluteUrl(text)) return text.split('.')[0] || '';

    try {
      const url = new URL(text);
      const parts = url.pathname.split('/').filter(Boolean);
      const bucketIndex = parts.indexOf(STORAGE_BUCKET);
      if (bucketIndex >= 0 && parts[bucketIndex + 2]) return parts[bucketIndex + 2];
      return '';
    } catch (error) {
      return '';
    }
  }

  function getPublicStorageUrl(path) {
    const { data } = sbClient.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  function getProjectDisplayUrl(project) {
    return project.url || project.hostingUrl || 'Unpublished';
  }

  function getProjectVisitUrl(project) {
    if (project.hostingUrl) return project.hostingUrl;
    if (isAbsoluteUrl(project.url)) return project.url;
    return `https://${project.url}`;
  }

  function projectFromRow(row, userId) {
    const slug = row.slug || extractSlugFromUrl(row.url);
    const storagePrefix = row.storage_prefix || (slug ? `${userId}/${slug}` : '');
    const entryPath = normalizeAssetPath(row.entry_path || 'index.html');
    const hostingUrl = row.hosting_url
      || (isAbsoluteUrl(row.url) ? row.url : '')
      || (storagePrefix ? getPublicStorageUrl(`${storagePrefix}/${entryPath}`) : '');

    return {
      name: row.name,
      slug,
      url: row.url,
      hostingUrl,
      storagePrefix,
      entryPath,
      fileLabel: row.file_label
    };
  }

  async function loadProjectRows(userId) {
    const selectors = [
      'name, slug, url, file_label, hosting_url, storage_prefix, entry_path',
      'name, slug, url, file_label',
      'name, url, file_label'
    ];

    for (const selector of selectors) {
      const { data, error } = await sbClient
        .from('projects')
        .select(selector)
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (!error) return data || [];
      console.warn(`Project query failed for columns "${selector}".`, error);
    }

    return [];
  }

  // Pulls the user's plan + deployed projects from Supabase and builds the
  // same session shape the rest of the UI already expects.
  async function loadSessionFromSupabase(authUser) {
    if (!authUser) return null;

    const [{ data: profile }, projects] = await Promise.all([
      sbClient.from('profiles').select('plan').eq('id', authUser.id).single(),
      loadProjectRows(authUser.id)
    ]);

    return normalizeSession({
      userId: authUser.id,
      email: authUser.email,
      name: authUser.user_metadata && authUser.user_metadata.full_name,
      plan: profile ? profile.plan : 'free',
      projects: (projects || []).map((p) => projectFromRow(p, authUser.id))
    });
  }

  // Re-renders the UI for the current in-memory session. Real persistence
  // happens via direct Supabase calls (see auth handlers, deploy handler, etc.)
  function applySession(session) {
    currentSession = normalizeSession(session);
    renderAuthArea();
    renderHeroTicket();
  }

  async function initAuth() {
    const { data: { session } } = await sbClient.auth.getSession();
    if (session) applySession(await loadSessionFromSupabase(session.user));

    sbClient.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        applySession(await loadSessionFromSupabase(session.user));
        if (pendingDestination === 'deploy') showDeployView();
        else if (pendingDestination === 'dashboard') showDashboardView();
        pendingDestination = null;
      } else {
        currentSession = null;
        renderAuthArea();
        renderHeroTicket();
        showHome();
      }
    });
  }

  function renderAuthArea() {
    if (!currentSession) {
      authArea.innerHTML = `
        <button type="button" class="nav-button" data-open-auth="signin">Sign in</button>
        <button type="button" class="nav-cta" data-open-auth="signup">Sign up</button>
      `;
      return;
    }

    const email = escapeHtml(currentSession.email || 'demo@vaultex.me');
    const initial = escapeHtml((currentSession.name || currentSession.email || 'V').charAt(0).toUpperCase());
    authArea.innerHTML = `
      <button type="button" class="nav-button" data-go-dashboard>Dashboard</button>
      <div class="user-chip">
        <span class="user-avatar">${initial}</span>
        <span class="user-email">${email}</span>
      </div>
      <button type="button" class="nav-button" data-sign-out>Sign out</button>
    `;
  }

  function setAuthMode(mode) {
    authMode = mode;
    const isSignup = mode === 'signup';
    document.querySelectorAll('[data-auth-mode]').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.authMode === mode);
    });
    nameField.hidden = !isSignup;
    confirmField.hidden = !isSignup;
    passwordRow.classList.toggle('single', !isSignup);
    signinMeta.hidden = isSignup;
    authPassword.autocomplete = isSignup ? 'new-password' : 'current-password';
    authTitle.textContent = isSignup ? 'Create your free account' : 'Sign in to deploy';
    authCopy.textContent = isSignup
      ? 'One account, one free project, and a live link in minutes.'
      : 'Continue to your free deployment workspace.';
    authSubmit.textContent = isSignup ? 'Create account' : 'Sign in';
    authMessage.textContent = '';
  }

  function openAuth(mode = 'signin', destination = null) {
    pendingDestination = destination;
    setAuthMode(mode);
    authModal.classList.add('is-open');
    authModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    setTimeout(() => {
      document.getElementById(mode === 'signup' ? 'auth-name' : 'auth-email').focus({ preventScroll: true });
    }, 30);
  }

  function closeAuth() {
    authModal.classList.remove('is-open');
    authModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    authMessage.textContent = '';
  }

  function completeAuth() {
    closeAuth();
    authForm.reset();
  }

  function showDeployView() {
    if (!currentSession) {
      openAuth('signup', 'deploy');
      return;
    }
    landingView.hidden = true;
    dashboardView.hidden = true;
    deployView.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateDeployAvailability();
  }

  function updateDeployAvailability() {
    if (!currentSession) return;
    const plan = currentSession.plan || 'free';
    const limit = PLAN_LIMITS[plan] || 1;
    const projects = currentSession.projects || [];
    const atLimit = projects.length >= limit;

    dropZone.classList.toggle('is-locked', atLimit);
    fileInput.disabled = atLimit;
    folderInput.disabled = atLimit;
    document.getElementById('choose-files').disabled = atLimit;
    document.getElementById('choose-folder').disabled = atLimit;
    dropZone.setAttribute('aria-disabled', atLimit ? 'true' : 'false');
    dropZone.tabIndex = atLimit ? -1 : 0;

    if (atLimit) {
      deployButton.disabled = false;
      deployButton.textContent = 'Upgrade to upload another site';
      deployButton.classList.add('is-upgrade');
      deployStatus.textContent = `Your ${PLAN_LABELS[plan] || 'Free'} plan already hosts ${projects.length} site${projects.length === 1 ? '' : 's'}. Upgrade to add more.`;
    } else {
      deployButton.classList.remove('is-upgrade');
      renderFiles();
    }
  }

  function showHome() {
    deployView.hidden = true;
    dashboardView.hidden = true;
    landingView.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goToPricing(tier) {
    deployView.hidden = true;
    dashboardView.hidden = true;
    landingView.hidden = false;
    const pricingSection = document.getElementById('pricing');
    if (pricingSection) pricingSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    document.querySelectorAll('.plan').forEach((card) => card.classList.remove('is-highlighted'));
    const plansGrid = document.querySelector('.plans');
    if (tier) {
      const target = document.querySelector(`.plan[data-plan="${tier}"]`);
      if (target) {
        if (plansGrid) plansGrid.classList.add('has-highlight');
        target.classList.add('is-highlighted');
        setTimeout(() => {
          target.classList.remove('is-highlighted');
          if (plansGrid) plansGrid.classList.remove('has-highlight');
        }, 2200);
      }
    } else if (plansGrid) {
      plansGrid.classList.remove('has-highlight');
    }
  }

  function showDashboardView() {
    if (!currentSession) {
      openAuth('signin', 'dashboard');
      return;
    }
    landingView.hidden = true;
    deployView.hidden = true;
    dashboardView.hidden = false;
    demoPlanSelect.value = currentSession.plan || 'free';
    renderDashboard();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderDashboard() {
    if (!currentSession) return;
    const plan = currentSession.plan || 'free';
    const limit = PLAN_LIMITS[plan] || 1;
    const projects = currentSession.projects || [];

    dashboardPill.textContent = `${PLAN_LABELS[plan] || 'Free'} plan \u00b7 ${projects.length}/${limit} projects`;

    let html = '';
    projects.forEach((project, index) => {
      html += `
        <div class="site-card" data-project-index="${index}">
          <div class="site-card-top">
            <div class="ticket-label">Deposited</div>
            <div class="live-badge">Live</div>
          </div>
          <div class="ticket-file">${escapeHtml(project.fileLabel || '[folder] site')}</div>
          <div class="ticket-arrow">issued as &darr;</div>
          <div class="ticket-url">${escapeHtml(getProjectDisplayUrl(project))}</div>
          <div class="site-card-footer">
            <button type="button" class="site-card-action" data-action="customize">Settings</button>
            <button type="button" class="site-card-action" data-action="visit">Visit site</button>
          </div>
        </div>
      `;
    });

    for (let i = projects.length; i < limit; i += 1) {
      html += `
        <button type="button" class="ticket-slot" data-action="deploy">
          <span class="slot-plus">+</span>
          <span>Deploy a new site</span>
        </button>
      `;
    }

    ticketGrid.innerHTML = html;
  }

  function openCustomize(project, plan, projectIndex) {
    currentCustomizeIndex = projectIndex;
    document.getElementById('customize-title').textContent = project.name || 'Untitled site';
    document.getElementById('customize-url').textContent = getProjectVisitUrl(project);

    const deleteButton = document.getElementById('delete-site-button');
    deleteButton.dataset.step = 'confirm';
    deleteButton.textContent = 'Delete site';
    deleteButton.disabled = false;
    deleteButton.classList.remove('is-confirm');

    const planIndex = PLAN_ORDER.indexOf(plan);
    let html = '';
    PLAN_ORDER.forEach((tier, tierIndex) => {
      const unlocked = planIndex >= tierIndex;
      FEATURE_TIERS[tier].forEach((feature) => {
        html += `
          <div class="toggle-row">
            <div class="toggle-copy">
              <strong>${escapeHtml(feature)}</strong>
              <span>${unlocked ? 'Available on your plan' : `Upgrade to ${PLAN_LABELS[tier]} to unlock`}</span>
            </div>
            ${unlocked
              ? '<span style="color:var(--teal);font-weight:700;font-size:18px">&#10003;</span>'
              : `<button type="button" class="text-link" data-go-pricing data-tier="${tier}">Upgrade</button>`}
          </div>
        `;
      });
    });

    document.getElementById('customize-features').innerHTML = html;
    customizeModal.classList.add('is-open');
    customizeModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function closeCustomize() {
    customizeModal.classList.remove('is-open');
    customizeModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    currentCustomizeIndex = null;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** unitIndex)).toFixed(unitIndex ? 1 : 0)} ${units[unitIndex]}`;
  }

  function makeSlug() {
    const first = ['amber', 'quiet', 'bright', 'little', 'swift', 'open', 'mint', 'gold'];
    const second = ['vault', 'page', 'launch', 'studio', 'site', 'pixel', 'corner', 'cloud'];
    const number = Math.floor(100 + Math.random() * 900);
    return `${first[Math.floor(Math.random() * first.length)]}-${second[Math.floor(Math.random() * second.length)]}-${number}`;
  }

  function refreshSiteUrl() {
    siteUrl.value = `${makeSlug()}.vaultex.me`;
  }

  function handleFiles(files) {
    if (currentSession) {
      const plan = currentSession.plan || 'free';
      const limit = PLAN_LIMITS[plan] || 1;
      const projects = currentSession.projects || [];
      if (projects.length >= limit) return;
    }
    selectedFiles = Array.from(files || []);
    renderFiles();
  }

  function renderFiles() {
    const totalBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    const htmlFiles = selectedFiles.filter((file) => /\.html?$/i.test(file.name));
    const hasIndex = selectedFiles.some((file) => {
      const path = file.webkitRelativePath || file.name;
      return path.toLowerCase() === 'index.html' || /\/index\.html$/i.test(path);
    });

    entryFile.innerHTML = '<option value="">Auto-detect index.html</option>';
    htmlFiles.forEach((file) => {
      const option = document.createElement('option');
      option.value = file.webkitRelativePath || file.name;
      option.textContent = file.webkitRelativePath || file.name;
      entryFile.appendChild(option);
    });

    if (!selectedFiles.length) {
      fileCount.textContent = 'No files selected';
      fileList.innerHTML = '<li class="file-empty">Your selected files will appear here.</li>';
      fileWarning.hidden = true;
      clearFilesButton.hidden = true;
      deployButton.disabled = true;
      deployStatus.textContent = 'Select your site files to continue.';
      return;
    }

    fileCount.textContent = `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} - ${formatBytes(totalBytes)}`;
    clearFilesButton.hidden = false;
    fileList.innerHTML = selectedFiles.slice(0, 8).map((file) => `
      <li class="file-item">
        <span class="file-name">${escapeHtml(file.webkitRelativePath || file.name)}</span>
        <span class="file-size">${formatBytes(file.size)}</span>
      </li>
    `).join('');

    if (selectedFiles.length > 8) {
      fileList.insertAdjacentHTML('beforeend', `<li class="file-empty">+ ${selectedFiles.length - 8} more files</li>`);
    }

    let warning = '';
    if (totalBytes > MAX_UPLOAD_BYTES) warning = `This upload is ${formatBytes(totalBytes)}. The free plan limit is 5 MB.`;
    else if (!hasIndex && !selectedFiles.some((file) => /\.zip$/i.test(file.name))) warning = 'No index.html was detected. Choose the correct entry file or add one before deploying.';

    fileWarning.textContent = warning;
    fileWarning.hidden = !warning;
    deployButton.disabled = totalBytes > MAX_UPLOAD_BYTES;
    deployStatus.textContent = totalBytes > MAX_UPLOAD_BYTES
      ? 'Remove files until the project is under 5 MB.'
      : 'Ready to upload and publish.';
  }

  function getContentType(path) {
    const extension = String(path || '').split('.').pop().toLowerCase();
    const types = {
      html: 'text/html; charset=utf-8',
      htm: 'text/html; charset=utf-8',
      css: 'text/css; charset=utf-8',
      js: 'text/javascript; charset=utf-8',
      mjs: 'text/javascript; charset=utf-8',
      json: 'application/json; charset=utf-8',
      txt: 'text/plain; charset=utf-8',
      xml: 'application/xml; charset=utf-8',
      svg: 'image/svg+xml',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      ico: 'image/x-icon',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf'
    };
    return types[extension] || 'application/octet-stream';
  }

  function stripSharedRoot(assets) {
    const paths = assets.map((asset) => asset.path).filter(Boolean);
    if (!paths.length) return assets;

    const firstSegment = paths[0].split('/')[0];
    const hasSharedRoot = firstSegment && paths.every((path) => path.split('/')[0] === firstSegment);
    const hasRootIndex = paths.some((path) => path.toLowerCase() === 'index.html');
    const hasNestedIndex = paths.some((path) => path.toLowerCase() === `${firstSegment.toLowerCase()}/index.html`);

    if (!hasSharedRoot || hasRootIndex || !hasNestedIndex) return assets;

    const prefix = `${firstSegment}/`;
    return assets.map((asset) => ({
      ...asset,
      path: asset.path.startsWith(prefix) ? asset.path.slice(prefix.length) : asset.path
    }));
  }

  async function buildAssetsFromZip(file) {
    if (!window.JSZip) {
      throw new Error('ZIP uploads need the JSZip library. Try uploading the extracted folder instead.');
    }

    const zip = await window.JSZip.loadAsync(file);
    const assets = [];

    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const path = normalizeAssetPath(entry.name);
      if (!path || path.startsWith('__MACOSX/')) continue;
      const blob = await entry.async('blob');
      assets.push({
        path,
        body: blob,
        size: blob.size,
        contentType: getContentType(path)
      });
    }

    return stripSharedRoot(assets);
  }

  async function buildDeploymentAssets() {
    if (!selectedFiles.length) throw new Error('Select your site files first.');

    const zipFiles = selectedFiles.filter((file) => /\.zip$/i.test(file.name));
    if (zipFiles.length) {
      if (selectedFiles.length > 1) throw new Error('Upload one ZIP by itself, or upload the extracted files/folder.');
      return buildAssetsFromZip(zipFiles[0]);
    }

    const assets = selectedFiles
      .map((file) => {
        const path = normalizeAssetPath(file.webkitRelativePath || file.name);
        return {
          path,
          body: file,
          size: file.size,
          contentType: file.type || getContentType(path)
        };
      })
      .filter((asset) => asset.path);

    return stripSharedRoot(assets);
  }

  function resolveEntryPath(assets) {
    const byLowerPath = new Map(assets.map((asset) => [asset.path.toLowerCase(), asset.path]));
    const selectedEntry = normalizeAssetPath(entryFile.value);

    if (selectedEntry) {
      const exact = byLowerPath.get(selectedEntry.toLowerCase());
      if (exact) return exact;

      const withoutRoot = selectedEntry.split('/').slice(1).join('/');
      const stripped = byLowerPath.get(withoutRoot.toLowerCase());
      if (stripped) return stripped;
    }

    const rootIndex = byLowerPath.get('index.html');
    if (rootIndex) return rootIndex;

    const nestedIndex = assets.find((asset) => /(^|\/)index\.html$/i.test(asset.path));
    if (nestedIndex) return nestedIndex.path;

    throw new Error('No index.html was found in this upload.');
  }

  async function uploadSiteAssets(slug) {
    const assets = await buildDeploymentAssets();
    if (!assets.length) throw new Error('No usable files were found in this upload.');

    const totalBytes = assets.reduce((sum, asset) => sum + asset.size, 0);
    if (totalBytes > MAX_UPLOAD_BYTES) {
      throw new Error(`This site is ${formatBytes(totalBytes)} after extraction. The free plan limit is 5 MB.`);
    }

    const entryPath = resolveEntryPath(assets);
    const storagePrefix = `${currentSession.userId}/${slug}`;

    for (const asset of assets) {
      const { error } = await sbClient.storage
        .from(STORAGE_BUCKET)
        .upload(`${storagePrefix}/${asset.path}`, asset.body, {
          cacheControl: '3600',
          contentType: asset.contentType,
          upsert: true
        });

      if (error) {
        throw new Error(`Upload failed for ${asset.path}: ${error.message}`);
      }
    }

    return {
      entryPath,
      storagePrefix,
      hostingUrl: getPublicStorageUrl(`${storagePrefix}/${entryPath}`),
      fileLabel: `[${assets.length} file${assets.length === 1 ? '' : 's'}]`
    };
  }

  async function insertProjectRecord(project) {
    const extendedPayload = {
      user_id: currentSession.userId,
      name: project.name,
      slug: project.slug,
      url: project.url,
      file_label: project.fileLabel,
      hosting_url: project.hostingUrl,
      storage_prefix: project.storagePrefix,
      entry_path: project.entryPath
    };

    const { error } = await sbClient.from('projects').insert(extendedPayload);
    if (!error) return null;

    console.warn('Project insert with hosting columns failed. Retrying with the basic schema.', error);
    const fallbackPayload = {
      user_id: currentSession.userId,
      name: project.name,
      slug: project.slug,
      url: project.hostingUrl || project.url,
      file_label: project.fileLabel
    };
    const { error: fallbackError } = await sbClient.from('projects').insert(fallbackPayload);
    return fallbackError;
  }

  async function listStoragePaths(prefix) {
    const { data, error } = await sbClient.storage.from(STORAGE_BUCKET).list(prefix, { limit: 1000 });
    if (error) throw error;

    const paths = [];
    for (const item of data || []) {
      const path = `${prefix}/${item.name}`;
      if (item.id) paths.push(path);
      else paths.push(...await listStoragePaths(path));
    }
    return paths;
  }

  async function deleteStoragePrefix(prefix) {
    if (!prefix) return;
    const paths = await listStoragePaths(prefix);
    if (!paths.length) return;

    const { error } = await sbClient.storage.from(STORAGE_BUCKET).remove(paths);
    if (error) throw error;
  }

  function deriveStoragePrefix(project) {
    if (project.storagePrefix) return project.storagePrefix;
    const slug = project.slug || extractSlugFromUrl(project.url) || extractSlugFromUrl(project.hostingUrl);
    return slug && currentSession ? `${currentSession.userId}/${slug}` : '';
  }

  async function deleteProjectRecord(project) {
    if (!currentSession || !currentSession.userId) return null;

    const urls = Array.from(new Set([project.url, project.hostingUrl].filter(Boolean)));
    let firstError = null;

    for (const url of urls) {
      const { error } = await sbClient
        .from('projects')
        .delete()
        .eq('user_id', currentSession.userId)
        .eq('url', url);

      if (error && !firstError) firstError = error;
    }

    return firstError;
  }

  function resetDeployForm() {
    selectedFiles = [];
    fileInput.value = '';
    folderInput.value = '';
    document.getElementById('site-name').value = '';
    document.getElementById('public-site').checked = true;
    successCard.hidden = true;
    refreshSiteUrl();
    updateDeployAvailability();
  }

  authArea.addEventListener('click', async (event) => {
    const authTrigger = event.target.closest('[data-open-auth]');
    if (authTrigger) openAuth(authTrigger.dataset.openAuth);

    if (event.target.closest('[data-go-dashboard]')) showDashboardView();

    const signOutButton = event.target.closest('[data-sign-out]');
    if (signOutButton) {
      signOutButton.disabled = true;
      signOutButton.textContent = 'Signing out...';

      let signOutError = null;
      try {
        const { error } = await sbClient.auth.signOut();
        signOutError = error;
      } catch (err) {
        signOutError = err;
      }

      if (signOutError) {
        console.error('Sign out request failed, clearing local session anyway.', signOutError);
      }

      // Clear the UI locally regardless of whether the network call succeeded.
      // Without this, a blocked/failed request to Supabase (ad blocker,
      // extension, brief network hiccup) leaves the user stuck signed in
      // with no feedback at all.
      currentSession = null;
      renderAuthArea();
      renderHeroTicket();
      showHome();
    }
  });

  document.querySelectorAll('[data-deploy-trigger]').forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      if (currentSession) showDeployView();
      else openAuth('signup', 'deploy');
    });
  });

  document.querySelectorAll('[data-go-home]').forEach((button) => button.addEventListener('click', showHome));
  document.querySelectorAll('[data-home-link]').forEach((link) => {
    link.addEventListener('click', () => {
      deployView.hidden = true;
      dashboardView.hidden = true;
      landingView.hidden = false;
    });
  });

  ticketGrid.addEventListener('click', (event) => {
    const deploySlot = event.target.closest('[data-action="deploy"]');
    if (deploySlot) {
      showDeployView();
      return;
    }

    const card = event.target.closest('.site-card');
    if (!card) return;
    const projectIndex = Number(card.dataset.projectIndex);
    const project = (currentSession.projects || [])[projectIndex];
    if (!project) return;

    if (event.target.closest('[data-action="visit"]')) {
      window.open(getProjectVisitUrl(project), '_blank', 'noopener');
    } else if (event.target.closest('[data-action="customize"]')) {
      openCustomize(project, currentSession.plan || 'free', projectIndex);
    }
  });

  demoPlanSelect.addEventListener('change', async () => {
    if (!currentSession) return;
    currentSession.plan = demoPlanSelect.value;
    renderDashboard();
    await sbClient.from('profiles').update({ plan: currentSession.plan }).eq('id', currentSession.userId);
  });

  document.getElementById('close-customize').addEventListener('click', closeCustomize);
  customizeModal.addEventListener('click', (event) => {
    if (event.target === customizeModal) closeCustomize();
    if (event.target.closest('[data-close-customize]')) closeCustomize();
    if (event.target.closest('[data-go-pricing]')) {
      const tier = event.target.closest('[data-go-pricing]').dataset.tier;
      closeCustomize();
      goToPricing(tier);
    }
  });

  document.getElementById('delete-site-button').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (button.dataset.step === 'confirm') {
      button.dataset.step = 'final';
      button.textContent = 'Click again to confirm';
      button.classList.add('is-confirm');
      return;
    }

    if (currentCustomizeIndex === null || !currentSession.projects) return;
    const project = currentSession.projects[currentCustomizeIndex];
    if (!project) return;

    button.disabled = true;
    button.textContent = 'Deleting...';

    const databaseError = await deleteProjectRecord(project);
    if (databaseError) {
      button.disabled = false;
      button.dataset.step = 'confirm';
      button.textContent = 'Delete failed';
      button.classList.remove('is-confirm');
      console.error('Project delete failed.', databaseError);
      setTimeout(() => { button.textContent = 'Delete site'; }, 1600);
      return;
    }

    try {
      await deleteStoragePrefix(deriveStoragePrefix(project));
    } catch (error) {
      console.warn('Storage cleanup failed after database delete.', error);
    }

    currentSession.projects.splice(currentCustomizeIndex, 1);
    closeCustomize();
    renderDashboard();
    renderHeroTicket();
    if (!deployView.hidden) updateDeployAvailability();
  });

  document.getElementById('docs-link').addEventListener('click', (event) => {
    event.preventDefault();
    alert('Documentation is coming next. This link is ready to point to your GitHub docs.');
  });

  document.querySelectorAll('[data-auth-mode]').forEach((tab) => {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode));
  });

  document.getElementById('close-auth').addEventListener('click', closeAuth);
  authModal.addEventListener('click', (event) => {
    if (event.target === authModal) closeAuth();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && authModal.classList.contains('is-open')) closeAuth();
  });

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('auth-name').value.trim();
    const email = document.getElementById('auth-email').value.trim();
    const password = authPassword.value;
    const confirm = authConfirm.value;

    if (!email || !email.includes('@')) {
      authMessage.textContent = 'Enter a valid email address.';
      return;
    }
    if (password.length < 6) {
      authMessage.textContent = 'Use a password with at least 6 characters.';
      return;
    }
    if (authMode === 'signup' && !name) {
      authMessage.textContent = 'Enter your name to create an account.';
      return;
    }
    if (authMode === 'signup' && password !== confirm) {
      authMessage.textContent = 'The passwords do not match.';
      return;
    }

    authSubmit.disabled = true;
    authMessage.style.color = '';
    authMessage.textContent = authMode === 'signup' ? 'Creating account...' : 'Signing in...';

    const { error } = authMode === 'signup'
      ? await sbClient.auth.signUp({ email, password, options: { data: { full_name: name } } })
      : await sbClient.auth.signInWithPassword({ email, password });

    authSubmit.disabled = false;

    if (error) {
      authMessage.style.color = 'var(--rust)';
      authMessage.textContent = error.message;
      return;
    }

    if (authMode === 'signup') {
      authMessage.style.color = 'var(--teal)';
      authMessage.textContent = 'Check your email to confirm your account, then sign in.';
      return;
    }

    completeAuth();
  });

  document.querySelectorAll('[data-provider]').forEach((button) => {
    button.addEventListener('click', async () => {
      const provider = button.dataset.provider;
      const { error } = await sbClient.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
      if (error) {
        authMessage.style.color = 'var(--rust)';
        authMessage.textContent = error.message;
      }
      // On success the browser is redirected away to the provider, then back here.
    });
  });

  document.getElementById('forgot-password').addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value.trim();
    if (!email || !email.includes('@')) {
      authMessage.style.color = 'var(--rust)';
      authMessage.textContent = 'Enter your email above first, then click "Forgot password".';
      return;
    }
    const { error } = await sbClient.auth.resetPasswordForEmail(email);
    authMessage.style.color = error ? 'var(--rust)' : 'var(--teal)';
    authMessage.textContent = error ? error.message : 'Password reset email sent.';
  });

  document.getElementById('choose-files').addEventListener('click', () => fileInput.click());
  document.getElementById('choose-folder').addEventListener('click', () => folderInput.click());
  dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') fileInput.click();
  });
  fileInput.addEventListener('change', () => handleFiles(fileInput.files));
  folderInput.addEventListener('change', () => handleFiles(folderInput.files));

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('drag-over');
    });
  });
  dropZone.addEventListener('drop', (event) => handleFiles(event.dataTransfer.files));

  clearFilesButton.addEventListener('click', () => {
    selectedFiles = [];
    fileInput.value = '';
    folderInput.value = '';
    renderFiles();
  });

  document.getElementById('refresh-slug').addEventListener('click', refreshSiteUrl);

  deployButton.addEventListener('click', async () => {
    if (deployButton.classList.contains('is-upgrade')) {
      goToPricing('mini');
      return;
    }
    if (!selectedFiles.length || deployButton.disabled) return;
    deployButton.disabled = true;
    deployButton.textContent = 'Deploying...';
    deployStatus.textContent = 'Uploading files to hosting storage...';

    try {
      const slug = extractSlugFromUrl(siteUrl.value) || makeSlug();
      const deployment = await uploadSiteAssets(slug);
      successUrl.textContent = deployment.hostingUrl;
      successCard.hidden = false;
      successCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      const plan = currentSession.plan || 'free';
      const limit = PLAN_LIMITS[plan] || 1;
      currentSession.projects = currentSession.projects || [];
      if (currentSession.projects.length < limit) {
        const project = {
          name: document.getElementById('site-name').value || 'Untitled site',
          slug,
          url: siteUrl.value,
          hostingUrl: deployment.hostingUrl,
          storagePrefix: deployment.storagePrefix,
          entryPath: deployment.entryPath,
          fileLabel: deployment.fileLabel
        };

        const error = await insertProjectRecord(project);

        if (error) {
          deployStatus.textContent = `Site is live, but account save failed: ${error.message}`;
        } else {
          deployStatus.textContent = 'Site is live and saved to your account.';
        }

        currentSession.projects.push(project);
        deployButton.disabled = false;
        deployButton.textContent = 'Deploy site free';
        renderHeroTicket();
        updateDeployAvailability();
      } else {
        deployButton.disabled = false;
        deployButton.textContent = 'Deploy site free';
        deployStatus.textContent = 'Your plan limit has been reached.';
      }
    } catch (error) {
      deployButton.disabled = false;
      deployButton.textContent = 'Deploy site free';
      deployStatus.textContent = error.message || 'Upload failed. Check your Supabase Storage setup.';
      console.error('Deployment failed.', error);
    }
  });

  document.getElementById('go-dashboard-from-success').addEventListener('click', showDashboardView);

  document.getElementById('copy-url').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(successUrl.textContent);
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy link'; }, 1400);
    } catch (error) {
      button.textContent = 'Select link';
    }
  });

  document.getElementById('new-deploy').addEventListener('click', resetDeployForm);

  function renderHeroTicket() {
    const wrap = document.getElementById('hero-ticket-wrap');
    const projects = currentSession && currentSession.projects;
    if (!projects || projects.length === 0) {
      wrap.hidden = true;
      return;
    }
    const latest = projects[projects.length - 1];
    document.getElementById('hero-ticket-file').textContent = latest.fileLabel || '[folder] site';
    document.getElementById('hero-ticket-url').textContent = getProjectDisplayUrl(latest);
    wrap.hidden = false;
  }

  refreshSiteUrl();
  renderFiles();
  renderAuthArea();
  renderHeroTicket();
  initAuth();
