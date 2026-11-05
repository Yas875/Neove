// Client Supabase minimal, sans dépendance, pour la connexion par e-mail et les demandes.
const SESSION_KEY = 'neove.session';

export class BackendError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

function friendly(status) {
  if (status === 429) return 'Trop de tentatives. Réessayez dans quelques minutes.';
  if (status === 401 || status === 403) return 'Votre session a expiré. Reconnectez-vous.';
  return 'Le service a refusé cette action. Réessayez dans un instant.';
}

export function createBackend({ url, key, fetch: fetcher, storage, now = () => Date.now() }) {
  async function call(path, { method = 'GET', body, rawBody, token, headers = {}, binary = false } = {}) {
    let res;
    try {
      res = await fetcher(`${url}${path}`, {
        method,
        headers: {
          apikey: key,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: rawBody ?? (body ? JSON.stringify(body) : undefined),
      });
    } catch {
      throw new BackendError('Connexion impossible. Vérifiez votre réseau, puis réessayez.', 0);
    }
    if (!res.ok) {
      let code;
      try { const data = JSON.parse(await res.text()); code = data?.error_code ?? data?.code; } catch { /* réponse sans détail */ }
      throw new BackendError(friendly(res.status), res.status, code);
    }
    if (binary) return res.blob();
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  function readSession() {
    try {
      const session = JSON.parse(storage.getItem(SESSION_KEY));
      return session?.access_token ? session : null;
    } catch { return null; }
  }
  function writeSession(session) {
    try { storage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* session limitée à cette page */ }
    memory = session;
  }
  function clearSession() {
    try { storage.removeItem(SESSION_KEY); } catch { /* rien à effacer */ }
    memory = null;
  }
  let memory = readSession();

  async function validToken() {
    if (!memory) return null;
    if (memory.expires_at - now() > 60_000) return memory.access_token;
    try {
      const data = await call('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: memory.refresh_token },
      });
      writeSession({
        access_token: data.access_token, refresh_token: data.refresh_token,
        expires_at: now() + data.expires_in * 1000, email: memory.email,
      });
      return memory.access_token;
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && error.status !== 429) clearSession();
      throw error;
    }
  }

  async function authed(path, options) {
    const token = await validToken();
    if (!token) throw new BackendError('Connectez-vous pour continuer.', 401);
    return call(path, { ...options, token });
  }

  function startSession(data, email) {
    writeSession({
      access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: now() + data.expires_in * 1000, email: data.user?.email ?? email,
    });
  }

  return {
    get email() { return memory?.email ?? null; },
    get signedIn() { return Boolean(memory); },

    async signUp(email, password) {
      try {
        const data = await call('/auth/v1/signup', { method: 'POST', body: { email, password } });
        if (!data?.access_token) return { confirm: true };
        startSession(data, email);
        return { signedIn: true };
      } catch (error) {
        if (error.code === 'user_already_exists' || error.code === 'email_exists') throw new BackendError('Un compte existe déjà avec cet e-mail. Connectez-vous.', error.status, error.code);
        if (error.code === 'weak_password') throw new BackendError('Ce mot de passe est trop simple. Choisissez-en un plus long.', error.status, error.code);
        if (error.code === 'validation_failed' || error.code === 'email_address_invalid') throw new BackendError('Vérifiez l’adresse e-mail.', error.status, error.code);
        throw error;
      }
    },

    async signIn(email, password) {
      try {
        const data = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
        startSession(data, email);
      } catch (error) {
        if (error.code === 'email_not_confirmed') throw new BackendError('Confirmez d’abord votre adresse avec le lien reçu par e-mail.', error.status, error.code);
        if (error.status === 400) throw new BackendError('E-mail ou mot de passe incorrect.', 400, error.code);
        throw error;
      }
    },

    sendPasswordReset(email, redirectTo) {
      return call(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: { email } });
    },

    async changePassword(password) {
      try {
        await authed('/auth/v1/user', { method: 'PUT', body: { password } });
      } catch (error) {
        if (error.code === 'weak_password' || error.code === 'same_password') throw new BackendError('Choisissez un mot de passe différent et plus long.', error.status, error.code);
        throw error;
      }
    },

    async getProfile() {
      const rows = await authed('/rest/v1/profiles?select=full_name,phone,home_location,avatar_path&limit=1');
      return rows[0] ?? null;
    },

    async saveProfile(profile) {
      const token = await validToken();
      if (!token) throw new BackendError('Connectez-vous pour continuer.', 401);
      const rows = await call('/rest/v1/profiles?on_conflict=user_id', {
        method: 'POST', token, body: { ...profile, user_id: userIdFromToken(token), updated_at: new Date(now()).toISOString() },
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      });
      return rows[0];
    },

    // Lit le retour du lien reçu par e-mail. Le jeton n'est accepté qu'après contrôle par le serveur.
    async consumeRedirect(hash) {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      if (params.get('error') || params.get('error_code')) {
        return { error: params.get('error_code') === 'otp_expired'
          ? 'Ce lien a expiré ou a déjà servi. Demandez-en un nouveau.'
          : 'La connexion a échoué. Demandez un nouveau lien.' };
      }
      const accessToken = params.get('access_token');
      if (!accessToken) return { ignored: true };
      const user = await call('/auth/v1/user', { token: accessToken });
      writeSession({
        access_token: accessToken, refresh_token: params.get('refresh_token'),
        expires_at: now() + Number(params.get('expires_in') ?? 3600) * 1000, email: user.email,
      });
      return params.get('type') === 'recovery' ? { signedIn: true, recovery: true } : { signedIn: true };
    },

    async deleteAccount() {
      await authed('/functions/v1/delete-account', { method: 'POST', body: {} });
      clearSession();
    },

    async signOut() {
      const token = memory?.access_token;
      clearSession();
      if (token) await call('/auth/v1/logout', { method: 'POST', token }).catch(() => {});
    },

    async createRequest(request) {
      const rows = await authed('/rest/v1/requests', {
        method: 'POST', body: request, headers: { Prefer: 'return=representation' },
      });
      return rows[0];
    },

    // Envoie la photo dans le dossier privé de l'utilisateur et renvoie son chemin.
    async uploadPhoto(blob, id = crypto.randomUUID()) {
      const token = await validToken();
      if (!token) throw new BackendError('Connectez-vous pour continuer.', 401);
      const path = `${userIdFromToken(token)}/${id}.jpg`;
      await call(`/storage/v1/object/request-photos/${path}`, {
        method: 'POST', rawBody: blob, token, headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
      });
      return path;
    },

    async analyzePhoto(path) {
      try {
        return await authed('/functions/v1/analyze-photo', { method: 'POST', body: { path } });
      } catch (error) {
        if (error.status === 429) throw new BackendError('La limite d’analyses du jour est atteinte. Continuez sans analyse.', 429);
        if (error.status === 401 || error.status === 0) throw error;
        throw new BackendError('L’analyse de la photo n’est pas disponible pour le moment.', error.status);
      }
    },

    // Fiches réelles et vérifiées, visibles sans connexion. Une liste vide garde l'app en démonstration.
    listPros() {
      return call('/rest/v1/pros?select=id,name,category,lat,lng,phone,verified,description,response_minutes,insurance_verified');
    },

    async getMyPro() {
      const token = await validToken();
      if (!token) return null;
      const rows = await call(`/rest/v1/pros?select=id,name,verified,rejected,category,location,phone,siret,description,response_minutes,insurance_verified&user_id=eq.${userIdFromToken(token)}&limit=1`, { token });
      return rows[0] ?? null;
    },

    listProRequests(proId) {
      return authed(`/rest/v1/requests?select=id,category,symptom,location,port,afloat,urgency_score,price_min,price_max,photo_path,contact_phone,status,created_at&pro_id=eq.${proId}&order=created_at.desc&limit=50`);
    },

    updateProRequest(requestId, action) {
      return authed('/rest/v1/rpc/pro_update_request', { method: 'POST', body: { p_request_id: requestId, p_action: action } });
    },

    async fetchPhoto(path) {
      return authed(`/storage/v1/object/request-photos/${path}`, { binary: true });
    },

    saveProProfile(pro) {
      return authed('/rest/v1/rpc/pro_save_profile', { method: 'POST', body: {
        p_name: pro.name, p_category: pro.category, p_location: pro.location,
        p_phone: pro.phone, p_siret: pro.siret, p_description: pro.description, p_response_minutes: pro.responseMinutes ?? null,
      } });
    },

    listRatings() {
      return call('/rest/v1/reviews?select=pro_id,rating');
    },

    listProReviews(proId) {
      return call('/rest/v1/rpc/pro_reviews', { method: 'POST', body: { p_pro_id: proId } });
    },

    // La nouvelle photo est enregistrée avant de retirer l'ancienne.
    async uploadAvatar(blob, previous) {
      const token = await validToken();
      if (!token) throw new BackendError('Connectez-vous pour continuer.', 401);
      const path = `${userIdFromToken(token)}/${crypto.randomUUID()}.jpg`;
      await call(`/storage/v1/object/avatars/${path}`, {
        method: 'POST', rawBody: blob, token, headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
      });
      const row = await this.saveProfile({ avatar_path: path });
      if (previous) await this.removeAvatarFile(previous).catch(() => {});
      return row;
    },

    removeAvatarFile(path) {
      return authed(`/storage/v1/object/avatars/${path}`, { method: 'DELETE' });
    },

    async removeAvatar(path) {
      const row = await this.saveProfile({ avatar_path: null });
      await this.removeAvatarFile(path).catch(() => {});
      return row;
    },

    async submitReview(requestId, rating, comment, showAuthor = false) {
      try {
        return await authed('/rest/v1/rpc/submit_review', { method: 'POST', body: { p_request_id: requestId, p_rating: rating, p_comment: comment, p_show_author: showAuthor } });
      } catch (error) {
        if (error.code === '23505') throw new BackendError('Vous avez déjà laissé un avis pour cette intervention.', error.status, error.code);
        throw error;
      }
    },

    myReviewedRequests() {
      return authed('/rest/v1/rpc/my_reviewed_requests', { method: 'POST', body: {} });
    },

    replyToReview(reviewId, reply) {
      return authed('/rest/v1/rpc/pro_reply_review', { method: 'POST', body: { p_review_id: reviewId, p_reply: reply } });
    },

    isAdmin() {
      return authed('/rest/v1/rpc/is_admin', { method: 'POST', body: {} });
    },
    adminListPros() {
      return authed('/rest/v1/rpc/admin_list_pros', { method: 'POST', body: {} });
    },
    adminSetPro(proId, action) {
      return authed('/rest/v1/rpc/admin_set_pro', { method: 'POST', body: { p_pro_id: proId, p_action: action } });
    },
    adminSetProInsurance(proId, verified) {
      return authed('/rest/v1/rpc/admin_set_pro_insurance', { method: 'POST', body: { p_pro_id: proId, p_verified: verified } });
    },
    adminListReviews() {
      return authed('/rest/v1/rpc/admin_list_reviews', { method: 'POST', body: {} });
    },
    adminSetReviewHidden(reviewId, hidden) {
      return authed('/rest/v1/rpc/admin_set_review_hidden', { method: 'POST', body: { p_review_id: reviewId, p_hidden: hidden } });
    },
    async adminClearReviewAvatar(reviewId) {
      const path = await authed('/rest/v1/rpc/admin_clear_review_avatar', { method: 'POST', body: { p_review_id: reviewId } });
      if (path) await this.removeAvatarFile(path).catch(() => {});
    },

    listRequests() {
      return authed('/rest/v1/requests?select=id,pro_id,category,symptom,location,port,status,price_min,price_max,created_at&order=created_at.desc&limit=50');
    },
  };
}

export function userIdFromToken(token) {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(part)).sub;
}

// Transforme le résultat du tri en ligne de la table requests.
export function toRequestRow(result, locationId, afloat, photoPath = null, proId = null, contactPhone = null, port = null) {
  return {
    category: result.category.id,
    symptom: result.symptom.id,
    location: locationId,
    afloat,
    urgency_score: result.score,
    price_min: result.price.min,
    price_max: result.price.max,
    photo_path: photoPath,
    pro_id: proId,
    contact_phone: contactPhone,
    port,
  };
}
