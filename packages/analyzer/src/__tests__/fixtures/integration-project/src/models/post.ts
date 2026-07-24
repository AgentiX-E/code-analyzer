/**
 * Post model — another entity that references User.
 * Demonstrates cross-file type references.
 */
import { User } from './user';

export interface PostMetadata {
  title: string;
  tags: string[];
  createdAt: Date;
}

export class Post {
  public id: number;
  public title: string;
  public content: string;
  public author: User;
  public metadata: PostMetadata;

  constructor(id: number, title: string, content: string, author: User) {
    this.id = id;
    this.title = title;
    this.content = content;
    this.author = author;
    this.metadata = {
      title,
      tags: [],
      createdAt: new Date(),
    };
  }

  /** Publish this post — verifies author is valid */
  public publish(): boolean {
    if (!this.author.validateEmail()) {
      return false;
    }
    return true;
  }

  /** Add tags to the post */
  public addTag(tag: string): void {
    if (!this.metadata.tags.includes(tag)) {
      this.metadata.tags.push(tag);
    }
  }
}
