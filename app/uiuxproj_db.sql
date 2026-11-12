CREATE DATABASE IF NOT EXISTS uiuxproj_db;
USE uiuxproj_db;

DROP TABLE IF EXISTS conflicts;
DROP TABLE IF EXISTS edits;
DROP TABLE IF EXISTS objects;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id        INT PRIMARY KEY,
    name      VARCHAR(50) NOT NULL,
    initials  VARCHAR(2)  NOT NULL,
    color     VARCHAR(7)  NOT NULL
);

CREATE TABLE objects (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    name             VARCHAR(100) NOT NULL,
    label            VARCHAR(100) NOT NULL,
    version          INT NOT NULL DEFAULT 1,
    editing_user_id  INT NULL,
    editing_since    DATETIME NULL,
    FOREIGN KEY (editing_user_id) REFERENCES users(id)
);

CREATE TABLE edits (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    object_id   INT NOT NULL,
    user_id     INT NOT NULL,
    action      VARCHAR(20) NOT NULL DEFAULT 'edit',
    old_value   VARCHAR(100) NULL,
    new_value   VARCHAR(100) NULL,
    undone      TINYINT(1) NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (object_id) REFERENCES objects(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE conflicts (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    object_id     INT NOT NULL,
    mine_user     INT NOT NULL,
    theirs_user   INT NOT NULL,
    mine_value    VARCHAR(100) NOT NULL,
    theirs_value  VARCHAR(100) NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'open',
    choice        VARCHAR(10) NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (object_id) REFERENCES objects(id),
    FOREIGN KEY (mine_user) REFERENCES users(id),
    FOREIGN KEY (theirs_user) REFERENCES users(id)
);

INSERT INTO users (id, name, initials, color) VALUES
  (1, 'Joseph', 'J', '#E11D48'),
  (2, 'Sarah',  'R', '#7C3AED'),
  (3, 'Alex',   'M', '#0891B2');

INSERT INTO objects (name, label, version) VALUES ('Login button', 'Login', 1);

INSERT INTO edits (object_id, user_id, action, old_value, new_value) VALUES
  (1, 1, 'edit', 'Submit', 'Login');