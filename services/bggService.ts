
import { BGGGameData } from '../types';

export const extractIdFromUrl = (input: string): string => {
  // Supporta vari formati di link BGG (boardgame/123, boardgame/123/nome, ecc)
  const match = input.match(/(?:boardgame\/|thing\/)([0-9]+)/i);
  if (match && match[1]) return match[1];
  
  // Rimuove spazi e cerca di capire se è un ID numerico puro
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  
  return trimmed; // Restituisce il nome per la ricerca
};

const getProxyUrl = (targetUrl: string) => {
  return `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}&_=${Date.now()}`;
};

export const fetchBGGData = async (input: string): Promise<BGGGameData> => {
  let cleanId = extractIdFromUrl(input);
  
  // Se l'input non è un numero ID, cerchiamo il gioco tramite API Search
  if (isNaN(Number(cleanId))) {
    const searchUrl = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(cleanId)}&type=boardgame&exact=1`;
    try {
      const searchRes = await fetch(getProxyUrl(searchUrl));
      const searchJson = await searchRes.json();
      const parser = new DOMParser();
      const searchDoc = parser.parseFromString(searchJson.contents || "", "text/xml");
      
      const firstItem = searchDoc.querySelector('item');
      if (firstItem) {
        cleanId = firstItem.getAttribute('id') || cleanId;
      } else {
        const looseSearchUrl = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(cleanId)}&type=boardgame`;
        const looseRes = await fetch(getProxyUrl(looseSearchUrl));
        const looseJson = await looseRes.json();
        const looseDoc = parser.parseFromString(looseJson.contents || "","text/xml");
        const looseItem = looseDoc.querySelector('item');
        if (!looseItem) throw new Error('Gioco non trovato su BGG');
        cleanId = looseItem.getAttribute('id') || '';
      }
    } catch (e) {
      throw new Error('Errore ricerca BGG');
    }
  }

  const bggUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${cleanId}&stats=1`;
  const response = await fetch(getProxyUrl(bggUrl));
  const json = await response.json();
  const xmlText = json.contents;

  if (!xmlText || xmlText.includes('<error')) throw new Error('Dati non disponibili');

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  const item = xmlDoc.querySelector('item');
  if (!item) throw new Error('Dettagli non trovati');

  const getVal = (s: string) => item.querySelector(s)?.getAttribute('value') || '';
  const getLinks = (t: string) => Array.from(item.querySelectorAll(`link[type="${t}"]`)).map(el => el.getAttribute('value') || '');

  return {
    id: cleanId,
    name: item.querySelector('name[type="primary"]')?.getAttribute('value') || item.querySelector('name')?.getAttribute('value') || 'Sconosciuto',
    image: item.querySelector('image')?.textContent || '',
    thumbnail: item.querySelector('thumbnail')?.textContent || '',
    description: item.querySelector('description')?.textContent || '',
    yearPublished: getVal('yearpublished'),
    minPlayers: getVal('minplayers'),
    maxPlayers: getVal('maxplayers'),
    playingTime: getVal('playingtime'),
    minAge: getVal('minage'),
    categories: getLinks('boardgamecategory'),
    mechanics: getLinks('boardgamemechanic'),
    designers: getLinks('boardgamedesigner'),
    artists: getLinks('boardgameartist'),
    publishers: getLinks('boardgamepublisher'),
    rank: 'N/A',
    averageRating: '0',
    comments: []
  };
};
