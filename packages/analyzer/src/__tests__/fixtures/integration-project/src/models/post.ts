export interface PostMetadata {
  title: string;
  authorId: string;
  createdAt: Date;
  tags: string[];
}

export class Post {
  id: string;
  title: string;
  content: string;
  authorId: string;
  createdAt: Date;

  constructor(id: string, title: string, content: string, authorId: string) {
    this.id = id;
    this.title = title;
    this.content = content;
    this.authorId = authorId;
    this.createdAt = new Date();
  }

  getMetadata(): PostMetadata {
    return {
      title: this.title,
      authorId: this.authorId,
      createdAt: this.createdAt,
      tags: [],
    };
  }
}
