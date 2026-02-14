
export interface CreativeEntry {
  name: string;
  photoUrl?: string;
}

export interface OptionalLinks {
  imageUrls: string[];
  bgaLink?: string;
  shopLink?: string;
  siteLink?: string;
  videoUrl?: string;
  rulesLink?: string;
  designers: CreativeEntry[];
  artists: CreativeEntry[];
  publisherInfo?: string;
  enrichmentNotes?: string;
}

export interface BGGComment {
  rating: string;
  value: string;
}

export interface GroundingSource {
  uri: string;
  title: string;
}

export interface BGGGameData {
  id: string;
  name: string;
  image: string;
  thumbnail: string;
  description: string;
  yearPublished: string;
  minPlayers: string;
  maxPlayers: string;
  playingTime: string;
  minAge: string;
  categories: string[];
  mechanics: string[];
  designers: string[];
  artists: string[];
  publishers: string[];
  rank: string;
  averageRating: string;
  comments: BGGComment[];
  sources?: GroundingSource[];
}

export interface GeneratedBlog {
  title: string;
  slug: string;
  seoTitle: string;
  metaDescription: string;
  excerpt: string;
  content: string;
  tags: string[];
  telegramPost: string;
  jsonLd: string; // Nuovo campo per i dati strutturati
  sources?: GroundingSource[];
}
