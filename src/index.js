'use strict';

var path = require('path');

var cheerio = require('cheerio');
var sizeOf = require('image-size');
var Q = require('q');

var PLUGIN_NAME = 'image-captions';

var onInit = function (gitbook) {
  var config = readConfig(gitbook);
  return readAllImages(gitbook)
    .then(function (images) {
      return preprocessImages(images, config);
    })
    .then(function (images) {
      persistImagesInConfig(gitbook, config, images);
    });
};

var onPage = function (gitbook, page) {
  var images = readImagesFromConfig(gitbook);
  var html = insertCaptions(images, page, page.content);
  page.content = html; // side effect!
  return page;
};

var getConfigValue = function (gitbook, expression, def) {
  return gitbook.config.get(expression) || def;
};

var readConfig = function (gitbook) {
  var config = getConfigValue(gitbook, 'pluginsConfig', {})[PLUGIN_NAME] || {};
  // set name of variable with images (available later for images list)
  config.variable_name = config.variable_name || '_pictures';
  return config;
};

var persistImagesInConfig = function (gitbook, config, images) {
  gitbook.config.set(['variables', config.variable_name], images); // side effect!
};

var readImagesFromConfig = function (gitbook) {
  var pluginConfig = readConfig(gitbook);
  return gitbook.config.get(['variables', pluginConfig.variable_name]);
};

function getCaptionTemplate (imageKey, options, captionVarName) {
  // try to get image specific template from plugin configuration options
  if (options.images && options.images[imageKey] && options.images[imageKey][captionVarName]) {
    return options.images[imageKey][captionVarName];
  } else if (options[captionVarName]) {
    return options[captionVarName];
  } else {
    return 'Figure: _CAPTION_';
  }
}

function createCaption (image, key, options, captionKey) {
  // replace supported template placeholders
  return renderTemplate(getCaptionTemplate(key, options, captionKey), image);
}

function renderTemplate (template, data) {
  return template
    .replace('_CAPTION_', data.label) // img title or alt attribute
    .replace('_PAGE_LEVEL_', data.level) // book page level
    .replace('_PAGE_IMAGE_NUMBER_', data.index) // order of the image on the page
    .replace('_BOOK_IMAGE_NUMBER_', data.nro); // order of the image on the book
}

function setImageAttributes (img, data) {
  for (var attr in data.attributes) {
    img.attr(attr, data.attributes[attr]);
  }
}

/*
    450 is what's in my book config.
    TODO: get from book config, and for each image
    TODO: fix the path hack.
*/
function findImageSize(src, page) {
  var fileSize = sizeOf(path.resolve('.', src.replace('/', '')));
  var MAX_WIDTH = 450;
  var displayWidth = Math.min(fileSize.width, 450);
  var ratio = fileSize.width / 450;
  return {
    height: Math.round(fileSize.height / ratio),
    width: displayWidth
  };
}

/*
Sample final SVG.
<svg xmlns="http://www.w3.org/2000/svg"
    writing-mode="tb-rl"
    width="30" height="400">
    <text text-anchor="middle" transform="rotate(180 15 200)" x="25" y="200">
      Hello, out there
    </text>
</svg>
*/
function buildYAxis(img, yAxis, page) {
    var src = img.attr('src');
    var fileSize = findImageSize(src, page);
    var height = fileSize.height;
    var midpoint = { x: 15, y: Math.round(height / 2)};
    var rotate = 'rotate(180 15 Y)'.replace('Y', midpoint.y);
    return '<svg class="figure-y-axis" xmlns="http://www.w3.org/2000/svg" writing-mode="tb-rl" width="30" height="H"><text text-anchor="middle" x="15" transform="R" y="Y">LABEL</text></svg>'.replace('H', height).replace('R', rotate).replace('LABEL', yAxis).replace('Y', midpoint.y);
}

function setImageCaption ($, img, data, page) {
  var imageParent = img.parent();
  data.label = img.attr('title') || img.attr('alt'); // all page variables are already interpolated
  var caption = renderTemplate(data.caption_template, data);
  var figure = '<figure id="fig' + data.key + '">';
  var y_axis = data['y-axis'];
  if (y_axis) {
      figure += buildYAxis(img, y_axis, page);
  }
  figure += $.html(img);
  var x_axis = data['x-axis'];
  if (x_axis) {
      figure += '<div class="figure-x-axis">' + x_axis + '</div>';
  }
  figure += '<figcaption>' + caption + '</figcaption></figure>';
  if (imageParent[0].tagName === 'p') {
    // the image is wrapped only by a paragraph
    imageParent.replaceWith(figure);
  } else {
    // the image is wrapped by a link and this link is then wrapped by a paragraph
    img.replaceWith(figure);
    imageParent.parent().replaceWith(imageParent);
  }
}

function setImageAlignment ($, img, data) {
  if (data.align) {
    $('figcaption').addClass(data.align); // TODO: this is wrong, it sets align to all!
  }
}

var insertCaptions = function (images, page, htmlContent) {
  var pageLevel = page.level;
  var $ = cheerio.load(htmlContent);
  // get all images from section content
  $('img').filter(function () {
    return shouldBeWrapped($(this));
  })
  .each(function (i) {
    var img = $(this);
    var key = pageLevel + '.' + (i + 1);
    var data = images.filter(function (item) { return item.key === key; })[0];
    if (data && !data.skip) {
      setImageAttributes(img, data);
      setImageCaption($, img, data, page);
      setImageAlignment($, img, data);
    }
  });
  return $.html();
};

function readImageAttributesFromConfig (config, imageKey) {
  if (config.images && config.images[imageKey] && config.images[imageKey].attributes) {
    return config.images[imageKey].attributes;
  } else if (config.attributes) {
    return config.attributes;
  }
  return {};
}

function readAlignFromConfig (config, imageKey) {
  if (config.images && config.images[imageKey] && config.images[imageKey].align) {
    return config.images[imageKey].align;
  } else if (config.align) {
    return config.align;
  }
  return null;
}

function readSkipFlag (config, imageKey) {
  if (config.images && config.images[imageKey] && typeof config.images[imageKey].skip === 'boolean') {
    return config.images[imageKey].skip;
  }
  return false;
}

function readAttrFromConfig (config, attr, imageKey) {
  if (config.images && config.images[imageKey] && config.images[imageKey][attr]) {
    return config.images[imageKey][attr];
  } else if (config[attr]) {
    return config[attr];
  }
  return null;
}


function shouldBeWrapped (img) {
  return img.parent().children().length === 1 &&
         img.parent().text() === '' &&
         (img.attr('title') || img.attr('alt'));
};

function preprocessImages (results, config) {
  var totalCounter = 1;
  return results.sort(function (a, b) {
    return a.order - b.order;
  })
  .reduce(function (acc, val) { return acc.concat(val.data); }, []) // flatten sections images
  .map(function (image) {
    image.nro = totalCounter++;
    // TODO: Consolidate
    image.attributes = readImageAttributesFromConfig(config, image.key);
    image['y-axis'] = readAttrFromConfig(config, 'y-axis', image.key);
    image['x-axis'] = readAttrFromConfig(config, 'x-axis', image.key);

    image.skip = readSkipFlag(config, image.key);

    var align = readAlignFromConfig(config, image.key);
    if (align) {
      image.align = align;
    }
    image.list_caption = createCaption(image, image.key, config, 'list_caption');
    image.caption_template = getCaptionTemplate(image.key, config, 'caption');
    return image;
  });
}

var getPageHtmlContent = function (gitbook, page) {
  return gitbook.readFileAsString(page.path)
    .then(function (text) {
      return gitbook.renderBlock('markdown', text); // TODO: what about AsciiDoc? Detection based on file extension?
    });
};

var parseImageData = function (page, index, img) {
  var image = {alt: img.attr('alt'), url: img.attr('src')};
  if (img.attr('title')) {
    image.title = img.attr('title');
  }
  image.label = image.title || image.alt;
  image.index = index + 1;
  image.level = page.level;
  image.key = page.level + '.' + image.index;

  // FIXME: is it gitbook or plugin responsibility?
  // SEE: https://github.com/todvora/gitbook-plugin-image-captions/issues/9
  var pageLink = page.ref.replace(/readme.md/gi, 'index.html').replace(/.md/, '.html');
  image.backlink = pageLink + '#fig' + image.key; // TODO
  return image;
};

var readAllImages = function (gitbook) {
  var promises = [];

  var pageIndex = 0;

  gitbook.summary.walk(function (page) {
    var currentPageIndex = pageIndex++;
    if (page.path) { // Check that there is truly a link
      promises.push(
        getPageHtmlContent(gitbook, page)
        .then(function (pageContent) {
          var $ = cheerio.load(pageContent);
          var pageImages = $('img')
            .filter(function () {
              return shouldBeWrapped($(this));
            })
            .map(function (index) {
              var img = $(this);
              return parseImageData(page, index++, img);
            }).get();
          return {
            data: pageImages.reduce(function (acc, val) { return acc.concat(val); }, []),
            order: currentPageIndex
          };
        }));
    }
  });
  return Q.all(promises);
};

module.exports = {
  website: {
    assets: './assets',
    css: [
      'image-captions.css'
    ]
  },
  ebook: {
    assets: './assets',
    css: [
      'image-captions.css'
    ]
  },
  hooks: {
    init: function () { // before book pages has been converted to html
      return onInit(this);
    },
    page: function (page) { // after page has been converted to html
      return onPage(this, page);
    }
  }
};
